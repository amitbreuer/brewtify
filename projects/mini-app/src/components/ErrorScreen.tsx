export function ErrorScreen() {
  const handleClose = () => {
    try {
      const webapp = (window as any).Telegram?.WebApp;
      if (webapp?.close) {
        webapp.close();
        return;
      }
    } catch {}
    window.location.reload();
  };

  return (
    <div className="min-h-screen bg-[#121212] text-white flex flex-col items-center justify-center p-6">
      <div className="w-20 h-20 mb-6 bg-[#282828] rounded-full flex items-center justify-center text-4xl">
        😵
      </div>

      <h1 className="text-2xl font-bold mb-2">Something went wrong</h1>
      <p className="text-[#B3B3B3] text-center mb-8 max-w-xs">
        We hit an unexpected error. Please try again later.
      </p>

      <button
        onClick={handleClose}
        className="w-full max-w-xs py-4 bg-[#282828] hover:bg-[#333333] text-white font-semibold rounded-full text-lg"
      >
        Close
      </button>
    </div>
  );
}
