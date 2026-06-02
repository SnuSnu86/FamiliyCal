import NetInfo from "@react-native-community/netinfo";
import { useEffect, useState } from "react";

type NetInfoState = Awaited<ReturnType<typeof NetInfo.fetch>>;

export function useNetworkStatus(): boolean {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      if (isMounted) {
        setIsOnline(Boolean(state.isConnected && state.isInternetReachable !== false));
      }
    });

    NetInfo.fetch()
      .then((state: NetInfoState) => {
        if (isMounted) {
          setIsOnline(Boolean(state.isConnected && state.isInternetReachable !== false));
        }
      })
      .catch(() => {
        if (isMounted) {
          setIsOnline(false);
        }
      });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  return isOnline;
}
