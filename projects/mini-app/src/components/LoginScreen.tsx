import brewtifyLogo from '../assets/brewtify-logo.png';

const API_BASE = import.meta.env.VITE_API_BASE || '';

export function LoginScreen() {
  const handleLogin = () => {
    const webapp = (window as any).Telegram?.WebApp;
    const userId = webapp?.initDataUnsafe?.user?.id?.toString()
      || import.meta.env.VITE_TELEGRAM_USER_ID;

    if (!userId) return;

    const loginUrl = `${API_BASE}/login?telegramUserId=${userId}`;

    if (webapp?.openLink) {
      webapp.openLink(loginUrl);
    } else {
      window.location.href = loginUrl;
    }
  };

  return (
    <div className="min-h-screen bg-[#121212] text-white flex flex-col items-center justify-center p-6">
      <div className="w-40 h-40 mb-6 flex items-center justify-center">
        <img src={brewtifyLogo} alt="Brewtify" className="w-40 h-40 rounded-full" />
      </div>

      <h1 className="text-2xl font-bold mb-2">Welcome to Brewtify</h1>
      <p className="text-[#B3B3B3] text-center mb-8 max-w-xs">
        Connect your Spotify account to manage and auto-update your playlists.
      </p>

      <button
        onClick={handleLogin}
        className="w-full max-w-xs py-4 bg-[#1DB954] hover:bg-[#1ED760] text-black font-bold rounded-full text-lg"
      >
        Connect with Spotify
      </button>
    </div>
  );
}
