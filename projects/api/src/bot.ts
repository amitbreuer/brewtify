import { Bot } from 'grammy';
import crypto from 'crypto';
import { env } from './utils/env';
import { spotifyService } from './services/spotify';
import { getAccessTokenForUser } from './routes/auth';
import { pendingAuthStore } from './services/pending-auth-store';
import { prisma } from './services/db';
import { calculateNextUpdate } from './services/scheduler';
import { createLogger } from './utils/logger';

const log = createLogger('bot');

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
      '/playlists \\- List your Spotify playlists\n' +
      '/schedule \\- Set auto\\-update schedule\n' +
      '/pause \\- Pause a playlist schedule\n' +
      '/resume \\- Resume a paused playlist\n' +
      '/status \\- Check your scheduled playlists',
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
      log.error('Failed to fetch playlists', { error: err instanceof Error ? err.message : String(err) });
      await ctx.reply('❌ Failed to fetch playlists. Try /login again.');
    }
  });

  // /schedule <playlist_name> <daily|weekly:N>
  // Example: /schedule "My Mix" daily
  // Example: /schedule "Chill Vibes" weekly:5
  bot.command('schedule', async (ctx) => {
    const telegramUserId = ctx.from?.id.toString();
    if (!telegramUserId) return;

    const text = ctx.message?.text || '';
    const args = text.replace('/schedule', '').trim();

    if (!args) {
      await ctx.reply(
        '📅 Usage: /schedule <playlist_name> <daily|weekly:N>\n\n' +
        'Examples:\n' +
        '• /schedule My Mix daily\n' +
        '• /schedule Chill Vibes weekly:5 (Friday)\n\n' +
        'Days: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat'
      );
      return;
    }

    // Parse: everything before last word is playlist name, last word is schedule
    const parts = args.split(/\s+/);
    const scheduleStr = parts[parts.length - 1];
    const playlistName = parts.slice(0, -1).join(' ');

    if (!playlistName || (!scheduleStr.match(/^daily$/) && !scheduleStr.match(/^weekly:[0-6]$/))) {
      await ctx.reply('❌ Invalid format. Use: /schedule <playlist_name> <daily|weekly:N>');
      return;
    }

    // Find the user's DB record
    const user = await prisma.user.findUnique({ where: { telegramUserId } });
    if (!user) {
      await ctx.reply('🔒 Please /login first.');
      return;
    }

    // Find the playlist in DB
    const playlist = await prisma.playlist.findFirst({
      where: { userId: user.id, name: { equals: playlistName, mode: 'insensitive' } },
    });

    if (!playlist) {
      await ctx.reply(`❌ Playlist "${playlistName}" not found. Use /playlists to see your playlists, then create one with /brew.`);
      return;
    }

    // Update schedule
    const nextUpdate = calculateNextUpdate(scheduleStr);
    await prisma.playlist.update({
      where: { id: playlist.id },
      data: {
        schedule: scheduleStr,
        nextUpdateAt: nextUpdate,
        status: 'active',
        failureCount: 0,
        lastError: null,
      },
    });

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const scheduleLabel = scheduleStr === 'daily'
      ? 'Daily at 00:00 UTC'
      : `Weekly on ${dayNames[parseInt(scheduleStr.split(':')[1])]} at 00:00 UTC`;

    await ctx.reply(`✅ Scheduled "${playlist.name}" — ${scheduleLabel}\n📅 Next update: ${nextUpdate.toISOString().split('T')[0]}`);
  });

  // /pause <playlist_name>
  bot.command('pause', async (ctx) => {
    const telegramUserId = ctx.from?.id.toString();
    if (!telegramUserId) return;

    const playlistName = (ctx.message?.text || '').replace('/pause', '').trim();
    if (!playlistName) {
      await ctx.reply('Usage: /pause <playlist_name>');
      return;
    }

    const user = await prisma.user.findUnique({ where: { telegramUserId } });
    if (!user) { await ctx.reply('🔒 Please /login first.'); return; }

    const playlist = await prisma.playlist.findFirst({
      where: { userId: user.id, name: { equals: playlistName, mode: 'insensitive' }, schedule: { not: null } },
    });

    if (!playlist) {
      await ctx.reply(`❌ No scheduled playlist named "${playlistName}" found.`);
      return;
    }

    await prisma.playlist.update({
      where: { id: playlist.id },
      data: { status: 'paused' },
    });

    await ctx.reply(`⏸️ Paused auto-update for "${playlist.name}".`);
  });

  // /resume <playlist_name>
  bot.command('resume', async (ctx) => {
    const telegramUserId = ctx.from?.id.toString();
    if (!telegramUserId) return;

    const playlistName = (ctx.message?.text || '').replace('/resume', '').trim();
    if (!playlistName) {
      await ctx.reply('Usage: /resume <playlist_name>');
      return;
    }

    const user = await prisma.user.findUnique({ where: { telegramUserId } });
    if (!user) { await ctx.reply('🔒 Please /login first.'); return; }

    const playlist = await prisma.playlist.findFirst({
      where: { userId: user.id, name: { equals: playlistName, mode: 'insensitive' }, status: 'paused' },
    });

    if (!playlist) {
      await ctx.reply(`❌ No paused playlist named "${playlistName}" found.`);
      return;
    }

    const nextUpdate = calculateNextUpdate(playlist.schedule!);
    await prisma.playlist.update({
      where: { id: playlist.id },
      data: { status: 'active', nextUpdateAt: nextUpdate, failureCount: 0, lastError: null },
    });

    await ctx.reply(`▶️ Resumed "${playlist.name}" — next update: ${nextUpdate.toISOString().split('T')[0]}`);
  });

  // /status — show all scheduled playlists
  bot.command('status', async (ctx) => {
    const telegramUserId = ctx.from?.id.toString();
    if (!telegramUserId) return;

    const user = await prisma.user.findUnique({ where: { telegramUserId } });
    if (!user) { await ctx.reply('🔒 Please /login first.'); return; }

    const playlists = await prisma.playlist.findMany({
      where: { userId: user.id, schedule: { not: null } },
      orderBy: { nextUpdateAt: 'asc' },
    });

    if (playlists.length === 0) {
      await ctx.reply('📭 No scheduled playlists. Use /schedule to set one up.');
      return;
    }

    const statusIcons: Record<string, string> = {
      active: '🟢', paused: '⏸️', failed: '🔴', auth_expired: '🔑',
    };

    const lines = playlists.map((p) => {
      const icon = statusIcons[p.status] || '⚪';
      const next = p.nextUpdateAt ? p.nextUpdateAt.toISOString().split('T')[0] : 'N/A';
      const sched = p.schedule === 'daily' ? 'Daily' : `Weekly`;
      return `${icon} ${p.name || p.spotifyPlaylistId} — ${sched} (next: ${next})`;
    });

    await ctx.reply(`📋 *Scheduled Playlists:*\n\n${lines.join('\n')}`);
  });

  bot.catch((err) => {
    log.error('Unhandled bot error', { error: err instanceof Error ? err.message : String(err) });
  });

  return bot;
}

function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}
