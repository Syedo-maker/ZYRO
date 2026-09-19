import { Request, RequestHandler, Response } from "express";
import type { ZodType } from "zod";
import { prisma, prismaUnscoped } from "../../lib/prisma";
import { hasStorePermission } from "../../lib/permissions";
import { Errors } from "../../errors/AppError";
import { posCatalogService } from "./catalog.service";
import { heldSaleService } from "./held.service";
import { posReportService } from "./report.service";
import { returnService } from "./return.service";
import { saleService } from "./sale.service";
import { shiftService } from "./shift.service";
import {
  closeShiftSchema,
  createSaleSchema,
  customerInputSchema,
  customerSearchSchema,
  dailyReportQuerySchema,
  holdSaleSchema,
  listSalesQuerySchema,
  openShiftSchema,
  posSettingsSchema,
  productSearchSchema,
  quoteSchema,
  returnSchema,
} from "./pos.validation";

/** Runs a handler, turning thrown errors into next(err) so the JSON error middleware answers. */
const route =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (err) {
      next(err);
    }
  };

// Input is `any` because the schemas transform lowercase wire enums into database enums.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parse<T>(schema: ZodType<T, any, any>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) throw Errors.validation(result.error.message);
  return result.data;
}

const storeId = (req: Request) => req.params.storeId;

export const posController = {
  /** Who is at the register and what they may do, so the screen can show only what will work. */
  session: route(async (req, res) => {
    const tenantId = storeId(req);
    const userId = req.userId!;
    const [tenant, user, sell, refunds, analytics, discounts] = await Promise.all([
      prisma.tenant.findUnique({ where: { id: tenantId } }),
      prismaUnscoped.user.findUnique({ where: { id: req.userId! }, select: { id: true, name: true, email: true } }),
      hasStorePermission(userId, tenantId, "POS_SELL"),
      hasStorePermission(userId, tenantId, "REFUNDS"),
      hasStorePermission(userId, tenantId, "ANALYTICS_READ"),
      hasStorePermission(userId, tenantId, "DISCOUNTS_WRITE"),
    ]);
    if (!tenant) throw Errors.notFound("Store");
    res.status(200).json({
      user: { id: userId, name: user?.name ?? null, email: user?.email ?? "" },
      isOwner: tenant.ownerId === userId,
      permissions: { sell, refunds, analytics, unlimitedDiscounts: discounts },
      store: { id: tenant.id, name: tenant.name, currency: tenant.currency, taxRate: Number(tenant.taxRate.toString()) },
      settings: { maxCashierDiscountPercent: Number(tenant.posMaxDiscountPercent.toString()) },
    });
  }),

  updateSettings: route(async (req, res) => {
    const input = parse(posSettingsSchema, req.body);
    await prisma.tenant.update({
      where: { id: storeId(req) },
      data: { posMaxDiscountPercent: input.maxCashierDiscountPercent.toFixed(2) },
    });
    res.status(200).json({ maxCashierDiscountPercent: input.maxCashierDiscountPercent });
  }),

  searchProducts: route(async (req, res) => {
    res.status(200).json(await posCatalogService.searchProducts(storeId(req), parse(productSearchSchema, req.query)));
  }),

  searchCustomers: route(async (req, res) => {
    res.status(200).json(await posCatalogService.searchCustomers(storeId(req), parse(customerSearchSchema, req.query).q));
  }),

  createCustomer: route(async (req, res) => {
    res.status(201).json(await posCatalogService.upsertCustomer(prisma, storeId(req), parse(customerInputSchema, req.body)));
  }),

  currentShift: route(async (req, res) => {
    res.status(200).json(await shiftService.current(storeId(req)));
  }),

  openShift: route(async (req, res) => {
    const input = parse(openShiftSchema, req.body);
    res.status(201).json(await shiftService.open(storeId(req), req.userId!, input.openingFloat));
  }),

  closeShift: route(async (req, res) => {
    const input = parse(closeShiftSchema, req.body);
    const tenant = await prisma.tenant.findUnique({ where: { id: storeId(req) }, select: { ownerId: true } });
    res.status(200).json(await shiftService.close(storeId(req), req.userId!, tenant?.ownerId === req.userId, input));
  }),

  quote: route(async (req, res) => {
    const input = parse(quoteSchema, req.body);
    const { view } = await saleService.quote(storeId(req), req.userId!, input.items, input.discount);
    res.status(200).json(view);
  }),

  createSale: route(async (req, res) => {
    const input = parse(createSaleSchema, req.body);
    const { sale, replayed } = await saleService.create(storeId(req), req.userId!, input);
    // A retried submission answers with the original sale (200) rather than making a second one (201).
    res.status(replayed ? 200 : 201).json(sale);
  }),

  listSales: route(async (req, res) => {
    res.status(200).json(await saleService.list(storeId(req), parse(listSalesQuerySchema, req.query)));
  }),

  getSale: route(async (req, res) => {
    res.status(200).json(await saleService.presentSale(storeId(req), req.params.orderId));
  }),

  createReturn: route(async (req, res) => {
    const input = parse(returnSchema, req.body);
    res.status(201).json(await returnService.create(storeId(req), req.params.orderId, req.userId!, input));
  }),

  holdSale: route(async (req, res) => {
    res.status(201).json(await heldSaleService.create(storeId(req), req.userId!, parse(holdSaleSchema, req.body)));
  }),

  listHeld: route(async (req, res) => {
    res.status(200).json(await heldSaleService.list(storeId(req)));
  }),

  resumeHeld: route(async (req, res) => {
    res.status(200).json(await heldSaleService.resume(storeId(req), req.params.heldId));
  }),

  discardHeld: route(async (req, res) => {
    await heldSaleService.discard(storeId(req), req.params.heldId);
    res.status(204).send();
  }),

  dailyReport: route(async (req, res) => {
    const q = parse(dailyReportQuerySchema, req.query);
    res.status(200).json(await posReportService.daily(storeId(req), q.from, q.to));
  }),
};
