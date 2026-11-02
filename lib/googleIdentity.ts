export interface GoogleIdentity {
  accounts: {
    id: {
      initialize(options: { client_id: string; callback: (response: { credential: string }) => void }): void;
      renderButton(element: HTMLElement, options: {
        theme: string; size: string; width: number; text: string; click_listener?: () => void;
      }): void;
    };
  };
}

declare global {
  interface Window { google?: GoogleIdentity; }
}

let loading: Promise<GoogleIdentity> | null = null;

export function loadGoogleIdentity(): Promise<GoogleIdentity> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  if (loading) return loading;

  loading = new Promise<GoogleIdentity>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-geomatrix-google-gsi="true"]');
    const script = existing || document.createElement('script');
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = () => {
      clearTimeout(timer);
      script.removeEventListener('load', onLoad);
      script.removeEventListener('error', onError);
    };
    const fail = () => {
      cleanup();
      script.remove();
      reject(new Error('Google sign-in could not load. Check your connection and try again.'));
    };
    const onLoad = () => {
      if (!window.google?.accounts?.id) { fail(); return; }
      cleanup();
      resolve(window.google);
    };
    const onError = () => fail();
    script.addEventListener('load', onLoad);
    script.addEventListener('error', onError);
    timer = setTimeout(fail, 15000);
    if (!existing) {
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.dataset.geomatrixGoogleGsi = 'true';
      document.head.appendChild(script);
    }
  }).catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}
