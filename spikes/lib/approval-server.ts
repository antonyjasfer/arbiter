// Spike helper (throwaway). Catches the PayPal buyer-approval redirect on localhost.
import { createServer } from "node:http";

export function waitForApproval(port: number, timeoutMs: number): Promise<{ token: string; payerId: string }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${port}`);
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      if (url.pathname === "/return") {
        const token = url.searchParams.get("token") ?? "";
        const payerId = url.searchParams.get("PayerID") ?? "";
        res.end("Approved. You can close this tab and return to the terminal.");
        finish(() => resolve({ token, payerId }));
      } else if (url.pathname === "/cancel") {
        res.end("Cancelled. You can close this tab.");
        finish(() => reject(new Error("Buyer cancelled the approval at PayPal.")));
      } else {
        res.statusCode = 404;
        res.end("not found");
      }
    });
    const timer = setTimeout(() => finish(() => reject(new Error(`Buyer approval timed out after ${Math.round(timeoutMs / 1000)}s.`))), timeoutMs);
    let done = false;
    function finish(action: () => void) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      server.close(() => action());
      server.closeAllConnections?.();
    }
    server.on("error", (e) => finish(() => reject(e)));
    server.listen(port, "127.0.0.1");
  });
}
