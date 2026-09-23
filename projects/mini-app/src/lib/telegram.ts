import { useEffect } from 'react';

interface TelegramWebApp {
  initData: string;
  ready?: () => void;
  expand?: () => void;
  openLink?: (url: string) => void;
  BackButton?: {
    show: () => void;
    hide: () => void;
    onClick: (handler: () => void) => void;
    offClick: (handler: () => void) => void;
  };
}

export function telegram(): TelegramWebApp | undefined {
  return (window as Window & { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
}

export function useTelegramBack(visible: boolean, onBack: () => void) {
  useEffect(() => {
    const back = telegram()?.BackButton;
    if (!back) return;
    if (visible) {
      back.show();
      back.onClick(onBack);
    } else back.hide();
    return () => {
      back.offClick(onBack);
      back.hide();
    };
  }, [visible, onBack]);
}
