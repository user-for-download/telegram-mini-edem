import { z } from "zod";

/**
 * Отчёт о клиентской ошибке — POST /api/v1/client-errors (публичный:
 * ошибки бывают до авторизации, ответ 204). User-Agent берётся на
 * сервере из заголовка, клиент его не присылает.
 */
export const CLIENT_ERROR_KINDS = [
  "error",
  "unhandledrejection",
  "boundary",
] as const;

export const clientErrorKindSchema = z.enum(CLIENT_ERROR_KINDS);
export type ClientErrorKind = z.infer<typeof clientErrorKindSchema>;

export const CLIENT_ERROR_MESSAGE_MAX_LENGTH = 500;
export const CLIENT_ERROR_STACK_MAX_LENGTH = 4000;
export const CLIENT_ERROR_COMPONENT_STACK_MAX_LENGTH = 1000;
export const CLIENT_ERROR_ROUTE_MAX_LENGTH = 200;
export const CLIENT_ERROR_RELEASE_MAX_LENGTH = 40;

export const clientErrorSchema = z.object({
  kind: clientErrorKindSchema,
  message: z.string().min(1).max(CLIENT_ERROR_MESSAGE_MAX_LENGTH),
  stack: z.string().max(CLIENT_ERROR_STACK_MAX_LENGTH).optional(),
  componentStack: z
    .string()
    .max(CLIENT_ERROR_COMPONENT_STACK_MAX_LENGTH)
    .optional(),
  route: z.string().max(CLIENT_ERROR_ROUTE_MAX_LENGTH).optional(),
  release: z.string().max(CLIENT_ERROR_RELEASE_MAX_LENGTH).optional(),
});

export type ClientError = z.infer<typeof clientErrorSchema>;
