import { Component } from 'react';
import type { ReactNode } from 'react';

export class LibraryErrorBoundary extends Component<{ children: ReactNode; partyEnabled: boolean }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="min-h-screen bg-[#121212] text-white p-6">
        <div role="alert" className="mx-auto max-w-lg space-y-4">
          <h1 className="text-2xl font-bold">Library could not load</h1>
          <p>A Library component failed to load or render.{this.props.partyEnabled && ' You can still open Party using the navigation below.'}</p>
          <button
            className="rounded-full bg-[#1DB954] text-black px-5 py-3 font-semibold"
            onClick={() => window.location.reload()}
          >
            Reload Brewtify
          </button>
        </div>
      </main>
    );
  }
}
