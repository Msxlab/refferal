import { Injectable } from '@nestjs/common';

export type BackgroundJobSnapshot = {
  maturationLastSuccessAt: Date | null;
  maturationLastDurationSeconds: number;
  maturationFailureCount: number;
};

@Injectable()
export class BackgroundJobStatusService {
  private maturationLastSuccessAt: Date | null = null;
  private maturationLastDurationSeconds = 0;
  private maturationFailureCount = 0;

  recordMaturationSuccess(durationSeconds: number): void {
    this.maturationLastSuccessAt = new Date();
    this.maturationLastDurationSeconds = durationSeconds;
  }

  recordMaturationFailure(): void {
    this.maturationFailureCount += 1;
  }

  snapshot(): BackgroundJobSnapshot {
    return {
      maturationLastSuccessAt: this.maturationLastSuccessAt
        ? new Date(this.maturationLastSuccessAt.getTime())
        : null,
      maturationLastDurationSeconds: this.maturationLastDurationSeconds,
      maturationFailureCount: this.maturationFailureCount,
    };
  }
}
