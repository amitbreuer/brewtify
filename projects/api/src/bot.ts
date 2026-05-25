import { Bot } from 'grammy';
import crypto from 'crypto';
import { env } from './utils/env';
import { spotifyService } from './services/spotify';
import { getAccessTokenForUser } from './routes/auth';
import { pendingAuthStore } from './services/pending-auth-store';

export function createBot() {
  const token = env('TELEGRAM_BOT_TOKEN');
  const bot = new Bot(token);

  bot.command('start', async (ctx) => {
    await ctx.reply('👋 Welcome to Brewtify Bot! Use /help to see available commands.');
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(
      '🎵 *Brewtify Bot*\n\n' +
      'Available commands:\n' +
      '/start \\- Start the bot\n' +
      '/help \\- Show this help message\n' +
      '/ping \\- Check if the bot is alive\n' +
      '/login \\- Connect your Spotify account\n' +
      '/playlists \\- List your Spotify playlists',
      { parse_mode: 'MarkdownV2' }
    );
  });

  bot.command('ping', async (ctx) => {
    await ctx.reply('🏓 Pong!');
  });

  bot.command('login', async (ctx) => {
    const telegramUserId = ctx.from?.id.toString();
    if (!telegramUserId) {
      await ctx.reply('❌ Could not identify your user.');
      return;
    }

    const state = crypto.randomBytes(16).toString('hex');
    await pendingAuthStore.set(state, telegramUserId);

    const authUrl = spotifyService.getAuthUrl(state);
    await ctx.reply(`🔗 Click the link below to connect your Spotify account:\n\n${authUrl}`);
  });

  bot.command('playlists', async (ctx) => {
    const telegramUserId = ctx.from?.id.toString();
    if (!telegramUserId) {
      await ctx.reply('❌ Could not identify your user.');
      return;
    }

    const accessToken = await getAccessTokenForUser(telegramUserId);
    if (!accessToken) {
      await ctx.reply('🔒 You are not logged in. Use /login to connect your Spotify account.');
      return;
    }

    try {
      const { items } = await spotifyService.getPlaylists(accessToken);
      if (!items || items.length === 0) {
        await ctx.reply('📭 You have no playlists.');
        return;
      }

      const lines = items.map((p, i) => `${escapeMarkdown(`${i + 1}.`)} *${escapeMarkdown(p.name)}* \\— ${p.tracks.total} tracks`);
      await ctx.reply(`🎶 *Your Playlists:*\n\n${lines.join('\n')}`, { parse_mode: 'MarkdownV2' });
    } catch (err) {
      console.error('Failed to fetch playlists:', err);
      await ctx.reply('❌ Failed to fetch playlists. Try /login again.');
    }
  });

  bot.catch((err) => {
    console.error('Bot error:', err);
  });

  return bot;
}

function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}
