import { BadRequestException, PipeTransform } from '@nestjs/common';
import { ZodIssue, ZodSchema } from 'zod';

/** All inputs are validated with zod (SPEC 10 - Security). */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'validation_failed',
        issues: result.error.issues.map((i: ZodIssue) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return result.data;
  }
}
