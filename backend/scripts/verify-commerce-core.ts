/**
 * End-to-end check of the Commerce Core Foundation against the real local databases:
 * pricing math, atomic stock deduction, oversell protection under concurrency, order
 * numbering, and cross-tenant isolation. Creates throwaway tenants and removes them after.
 * Usage: npx tsx scripts/verify-commerce-core.ts
 */
import mongoose from "mongoose";
import { connectMongo } from "../src/lib/mongo";
import { prisma, prismaUnscoped } from "../src/lib/prisma";
import { tenantContext } from "../src/lib/tenantContext";
import { Product } from "../src/models/Product.model";
import { authService } from "../src/modules/auth/auth.service";
import { productService } from "../src/modules/products/product.service";
import { createOrder } from "../src/modules/commerce/order.service";
import { calculateTotals } from "../src/modules/commerce/pricing.service";

let failures = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!ok) failures++;
}

async function makeTenant(tag: string) {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await authService.register({
    email: `verify-${tag}-${suffix}@example.com`,
    password: "password123",
    storeName: `Verify ${tag}`,
    storeSlug: `verify-${tag}-${suffix}`,
  });
  const tenant = await prismaUnscoped.tenant.findUnique({ where: { slug: `verify-${tag}-${suffix}` } });
  return tenant!;
}

const stockOf = (tenantId: string, productId: string) =>
  tenantContext.run(tenantId, async () => (await productService.get(tenantId, productId)).stock);

async function main() {
  await connectMongo();

  // 1. Pricing math (pure)
  const p = calculateTotals({
    lines: [
      { unitPrice: 19.99, quantity: 3, taxable: true },
      { unitPrice: 5, quantity: 1, taxable: false },
    ],
    discount: { type: "PERCENTAGE", value: 10 },
    shippingAmount: 4.5,
    taxRatePercent: 8.25,
  });
  // subtotal 64.97, discount 6.50 (rounded), taxable base 59.97 - round(6.50*59.97/64.97)=6.00 -> 53.97, tax 4.45, total 64.97-6.50+4.45+4.50
  check("pricing: subtotal", p.subtotal === "64.97", p.subtotal);
  check("pricing: discount", p.discountAmount === "6.50", p.discountAmount);
  check("pricing: total is consistent", p.total === "67.42", p.total);
  check(
    "pricing: fixed discount capped at subtotal",
    calculateTotals({ lines: [{ unitPrice: 10, quantity: 1, taxable: false }], discount: { type: "FIXED", value: 99 }, taxRatePercent: 0 })
      .total === "0.00"
  );

  const tenantA = await makeTenant("a");
  const tenantB = await makeTenant("b");
  const created: string[] = [];

  try {
    await prismaUnscoped.tenant.update({ where: { id: tenantA.id }, data: { taxRate: "10" } });

    const locations = await prismaUnscoped.location.findMany({ where: { tenantId: tenantA.id } });
    check("registration creates one default location", locations.length === 1 && locations[0].isDefault);

    // 2. Product with stock lives in inventory, not Mongo
    const product = await tenantContext.run(tenantA.id, () =>
      productService.create(
        tenantA.id,
        { title: "Test Widget", description: "", price: 20, stock: 10, category: "test", images: [], taxable: true, sku: "W-1" },
        undefined
      )
    );
    created.push(product.id);
    check("product create records stock in inventory", (await stockOf(tenantA.id, product.id)) === 10);
    const rawDoc = await mongoose.connection.collection("products").findOne({ _id: new mongoose.Types.ObjectId(product.id) });
    check("stock is not persisted on the Mongo product", rawDoc !== null && !("stock" in rawDoc));

    const dup = await tenantContext
      .run(tenantA.id, () =>
        productService.create(tenantA.id, { title: "Dup", description: "", price: 1, stock: 1, category: "t", images: [], taxable: true, sku: "W-1" })
      )
      .then(() => false)
      .catch(() => true);
    check("duplicate SKU in the same store is rejected", dup);

    // 3. POS sale: 3 x 20 = 60 + 10% tax = 66.00
    const pos = await tenantContext.run(tenantA.id, () =>
      createOrder({
        tenantId: tenantA.id,
        channel: "POS",
        items: [{ productId: product.id, quantity: 3 }],
        payments: [{ method: "CASH", amount: 66 }],
      })
    );
    check("POS order: number 1, COMPLETED, correct totals", pos.orderNumber === 1 && pos.status === "COMPLETED" && pos.total.toString() === "66" && pos.taxAmount.toString() === "6", `#${pos.orderNumber} ${pos.status} total=${pos.total}`);
    check("POS sale deducts stock (10 -> 7)", (await stockOf(tenantA.id, product.id)) === 7);

    // 4. Online sale shares the same stock: 2 x 20 = 40 + 4 tax = 44.00
    const online = await tenantContext.run(tenantA.id, () =>
      createOrder({
        tenantId: tenantA.id,
        channel: "ONLINE",
        guestEmail: "buyer@example.com",
        items: [{ productId: product.id, quantity: 2 }],
        payments: [{ method: "STRIPE", amount: 44, stripePaymentIntentId: `pi_verify_${Date.now()}` }],
      })
    );
    check("online order: number 2, PAID, channel ONLINE", online.orderNumber === 2 && online.status === "PAID" && online.channel === "ONLINE");
    check("online sale draws from the same stock (7 -> 5)", (await stockOf(tenantA.id, product.id)) === 5);

    // 5. Oversell and payment mismatch are rejected with nothing written
    const oversell = await tenantContext
      .run(tenantA.id, () =>
        createOrder({ tenantId: tenantA.id, channel: "POS", items: [{ productId: product.id, quantity: 100 }], payments: [{ method: "CASH", amount: 2200 }] })
      )
      .then(() => "ok")
      .catch((e: Error) => e.message);
    check("oversell is rejected", oversell === "Insufficient stock", oversell);
    check("rejected order leaves stock unchanged", (await stockOf(tenantA.id, product.id)) === 5);

    const mismatch = await tenantContext
      .run(tenantA.id, () =>
        createOrder({ tenantId: tenantA.id, channel: "POS", items: [{ productId: product.id, quantity: 1 }], payments: [{ method: "CASH", amount: 1 }] })
      )
      .then(() => "ok")
      .catch((e: Error) => e.message);
    check("payment that does not match total is rejected", mismatch === "Request validation failed", mismatch);

    // 6. Concurrency: 5 registers race for the last unit
    await tenantContext.run(tenantA.id, () =>
      productService.update(tenantA.id, product.id, { title: "Test Widget", description: "", price: 20, stock: 1, category: "test", images: [], taxable: true, sku: "W-1" })
    );
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        tenantContext.run(tenantA.id, () =>
          createOrder({ tenantId: tenantA.id, channel: "POS", items: [{ productId: product.id, quantity: 1 }], payments: [{ method: "CASH", amount: 22 }] })
        )
      )
    );
    const won = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<{ orderNumber: number }>[];
    check("5 concurrent sales of the last unit: exactly 1 succeeds", won.length === 1, `succeeded=${won.length}`);
    check("stock ends at exactly 0, never negative", (await stockOf(tenantA.id, product.id)) === 0);
    check("failed orders did not consume order numbers", won[0]?.value.orderNumber === 3, `winner is #${won[0]?.value.orderNumber}`);

    // 7. Ledger explains the current quantity
    const movements = await prismaUnscoped.stockMovement.findMany({ where: { tenantId: tenantA.id, productId: product.id }, orderBy: { createdAt: "asc" } });
    const ledgerSum = movements.reduce((s, m) => s + m.quantityChange, 0);
    check("stock ledger sums to current quantity", ledgerSum === 0, `sum=${ledgerSum}, rows=${movements.length}`);

    // 8. Tenant isolation
    const crossTenantOrder = await tenantContext
      .run(tenantB.id, () =>
        createOrder({ tenantId: tenantB.id, channel: "POS", items: [{ productId: product.id, quantity: 1 }], payments: [{ method: "CASH", amount: 20 }] })
      )
      .then(() => "ok")
      .catch((e: Error) => e.message);
    check("tenant B cannot sell tenant A's product", crossTenantOrder === "Product not found", crossTenantOrder);
    // Even when B's request explicitly asks for A's tenantId, the scoping layer pins it to B.
    const visibleToB = await tenantContext.run(tenantB.id, async () =>
      prisma.inventoryLevel.findMany({ where: { tenantId: tenantA.id } })
    );
    check("tenant B cannot read tenant A's inventory even by asking for it", visibleToB.length === 0);
  } finally {
    await Product.deleteMany({ storeId: { $in: [tenantA.id, tenantB.id] } });
    for (const t of [tenantA, tenantB]) {
      await prismaUnscoped.tenant.delete({ where: { id: t.id } });
      await prismaUnscoped.user.delete({ where: { id: t.ownerId } });
    }
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  await mongoose.disconnect();
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
