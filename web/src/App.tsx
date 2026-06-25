import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { Background } from "./components/Background.tsx";
import { ToastHost } from "./components/Toast.tsx";
import { type Route, TopBar } from "./components/TopBar.tsx";
import { api, type AppState } from "./lib/api.ts";
import { viewVariants } from "./lib/motion.ts";
import { Chat } from "./screens/Chat.tsx";
import { Settings } from "./screens/Settings.tsx";

function routeFromHash(): Route {
  return window.location.hash.includes("settings") ? "settings" : "chat";
}

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [failed, setFailed] = useState(false);
  const [route, setRoute] = useState<Route>(routeFromHash());

  useEffect(() => {
    api
      .state()
      .then((s) => {
        setState(s);
        // Steer first-time users straight to the Slate to attune a model.
        if (!s.setupComplete && !window.location.hash.includes("settings")) {
          setRoute("settings");
        }
      })
      .catch((e) => {
        if ((e as { status?: number }).status !== 401) setFailed(true);
      });
  }, []);

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const navigate = (r: Route) => {
    setRoute(r);
    window.location.hash = r === "settings" ? "/settings" : "/";
  };

  if (failed) {
    return (
      <div className="grid h-full place-items-center px-6 text-center">
        <div>
          <div className="display text-xl text-ink">The slate is dim</div>
          <p className="mt-2 text-sm text-ink-dim">Couldn't reach the companion. Check that the server is running.</p>
        </div>
      </div>
    );
  }

  if (!state) {
    return <Background />;
  }

  return (
    <ToastHost>
      <Background />
      <div className="flex h-full flex-col">
        <TopBar state={state} route={route} onNavigate={navigate} authEnabled={!!state.auth?.enabled} />
        <main className="relative min-h-0 flex-1">
          <AnimatePresence mode="wait">
            <motion.div
              key={route}
              variants={viewVariants}
              initial="initial"
              animate="enter"
              exit="exit"
              className="absolute inset-0"
            >
              {route === "chat" ? <Chat state={state} /> : <Settings state={state} />}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </ToastHost>
  );
}
