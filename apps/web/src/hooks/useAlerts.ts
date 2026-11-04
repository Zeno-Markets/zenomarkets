import { useQuery } from "@tanstack/react-query";
import { apiGet, type AlertRow, type NotificationRow } from "@/lib/alerts";
import { env } from "@/lib/env";

/// The wallet's active and triggered alerts.
export function useAlertList(wallet: string | undefined) {
  return useQuery({
    queryKey: ["alerts", env.apiUrl, wallet?.toLowerCase()],
    queryFn: () => apiGet<{ maxActive: number; alerts: AlertRow[] }>(`/v1/alerts/${wallet}`),
    enabled: Boolean(env.apiUrl && wallet),
    refetchInterval: 30_000,
    retry: false,
  });
}

/// The bell's list. Polled every 30 seconds while a wallet is connected.
export function useNotifications(wallet: string | undefined) {
  return useQuery({
    queryKey: ["notifications", env.apiUrl, wallet?.toLowerCase()],
    queryFn: () => apiGet<{ notifications: NotificationRow[] }>(`/v1/notifications/${wallet}`),
    enabled: Boolean(env.apiUrl && wallet),
    refetchInterval: 30_000,
    retry: false,
  });
}
