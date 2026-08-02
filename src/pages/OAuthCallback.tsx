import { useSearchParams } from 'react-router-dom';
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

const OAuthCallback = () => {
  const [searchParams] = useSearchParams();
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!code) return;
    await navigator.clipboard.writeText(code);
    setCopied(true);
  };

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <section className="w-full max-w-lg rounded-xl border p-8 text-center">
          <h1 className="text-2xl font-semibold text-destructive">Authorization failed</h1>
          <p className="mt-3 text-muted-foreground">{searchParams.get('error_description') || error}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <section className="w-full max-w-lg space-y-5 rounded-xl border p-8">
        <div className="flex items-center gap-3">
          <Check className="h-6 w-6 text-green-600" />
          <h1 className="text-2xl font-semibold">Authorization complete</h1>
        </div>
        {code ? (
          <>
            <p className="text-muted-foreground">Copy this authorization code and give it back to your MCP agent.</p>
            <code className="block break-all rounded-md bg-muted p-4 text-sm">{code}</code>
            <Button onClick={copy} className="w-full">
              <Copy className="mr-2 h-4 w-4" />
              {copied ? 'Copied' : 'Copy authorization code'}
            </Button>
            {state && <p className="break-all text-xs text-muted-foreground">State: {state}</p>}
          </>
        ) : (
          <p className="text-muted-foreground">No authorization code was returned.</p>
        )}
      </section>
    </main>
  );
};

export default OAuthCallback;
