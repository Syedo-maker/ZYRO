import type { ShippingZone } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { Errors } from "../../errors/AppError";
import type { ShippingZoneInput } from "./shipping.validation";

const toView = (z: ShippingZone) => ({
  id: z.id,
  name: z.name,
  region: z.region,
  rateAmount: Number(z.rateAmount.toString()),
});

/**
 * Flat-rate shipping per region. Checkout snapshots the zone's name and rate into the
 * order, so editing or deleting a zone never changes an order that was already placed.
 */
export const shippingService = {
  async list(tenantId: string) {
    const zones = await prisma.shippingZone.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } });
    return zones.map(toView);
  },

  async create(tenantId: string, input: ShippingZoneInput) {
    const zone = await prisma.shippingZone.create({
      data: { tenantId, name: input.name, region: input.region, rateAmount: input.rateAmount.toFixed(2) },
    });
    return toView(zone);
  },

  async update(tenantId: string, zoneId: string, input: ShippingZoneInput) {
    const { count } = await prisma.shippingZone.updateMany({
      where: { id: zoneId, tenantId },
      data: { name: input.name, region: input.region, rateAmount: input.rateAmount.toFixed(2) },
    });
    if (count === 0) throw Errors.notFound("Shipping zone");
    const zone = await prisma.shippingZone.findFirst({ where: { id: zoneId, tenantId } });
    return toView(zone!);
  },

  async remove(tenantId: string, zoneId: string) {
    const { count } = await prisma.shippingZone.deleteMany({ where: { id: zoneId, tenantId } });
    if (count === 0) throw Errors.notFound("Shipping zone");
  },
};
