import "@fontsource-variable/geist/wght.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";
import "sonner/dist/styles.css";
import App from "./App";
import { TooltipProvider } from "./components/ui/menu";
import { ThemeProvider, useTheme } from "./lib/theme";
import "./index.css";

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 10_000 } } });

function ToasterHost() {
  const { resolved } = useTheme();
  return <Toaster theme={resolved} position="top-center" offset={12} mobileOffset={{ top: 12 }} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <TooltipProvider delayDuration={300}>
            <App />
            <ToasterHost />
          </TooltipProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
