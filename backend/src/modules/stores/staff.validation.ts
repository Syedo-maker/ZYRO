import { z } from "zod";
import { StaffPermission } from "@prisma/client";

export const createStaffSchema = z.object({
  email: z.string().email(),
  permissions: z.array(z.nativeEnum(StaffPermission)).min(1),
});
export type CreateStaffInput = z.infer<typeof createStaffSchema>;
