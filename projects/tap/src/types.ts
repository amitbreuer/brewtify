export type TapEventType =
  | 'user.start'
  | 'user.login'
  | 'playlist.create'
  | 'playlist.update'
  | 'playlist.schedule'
  | 'cron.start'
  | 'cron.success'
  | 'cron.failure'
  | 'cron.summary'
  | 'error.auth'
  | 'error.general';

export interface TapEvent {
  type: TapEventType;
  userId?: string;
  username?: string;
  message: string;
  meta?: Record<string, unknown>;
  timestamp?: Date;
}
