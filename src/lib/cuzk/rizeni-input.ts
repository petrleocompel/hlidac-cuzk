import { z } from 'zod'
import { TYPY_RIZENI } from './rizeni-codes'

/** Browser-safe follow-řízení input (no DB / HTTP imports). */
export const FollowInput = z
  .object({
    watchId: z.string().uuid(),
    /** ISKN id, e.g. from navazanaRizeni. */
    rizeniId: z
      .string()
      .regex(/^[1-9]\d{0,27}$/)
      .optional(),
    typRizeni: z.enum(TYPY_RIZENI).optional(),
    cislo: z.coerce.number().int().min(1).max(99_999_999).optional(),
    rok: z.coerce.number().int().min(2003).max(2099).optional(),
    kodPracoviste: z.coerce.number().int().min(1).max(999).optional(),
  })
  .refine(
    (value) =>
      value.rizeniId != null ||
      (value.typRizeni != null &&
        value.cislo != null &&
        value.rok != null &&
        value.kodPracoviste != null),
    'Zadejte ISKN id řízení, nebo typ, číslo, rok a kód pracoviště.',
  )

export type FollowInputValue = z.infer<typeof FollowInput>
