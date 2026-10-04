import type { RevalidationResult } from '@/services/pageService';

interface RevalidationFeedbackProps {
  result: RevalidationResult;
  language: string;
}

export function RevalidationFeedback({ result, language }: RevalidationFeedbackProps) {
  const english = language === 'en';
  const diagnostics = result.diagnostics;

  return (
    <div className="space-y-2 text-xs">
      <p className={result.success ? 'text-green-700 dark:text-green-400' : 'text-amber-700 dark:text-amber-400'}>
        {result.message}
      </p>
      {!result.success && diagnostics && (
        <details className="rounded-md border border-amber-500/30 px-3 py-2">
          <summary className="cursor-pointer select-none font-medium">
            {english ? 'Revalidation details' : 'Details zur Revalidierung'}
          </summary>
          <div className="mt-2 space-y-2 break-words text-muted-foreground">
            {diagnostics.httpStatus !== undefined && (
              <p>{english ? 'CMS response status:' : 'Antwortstatus des CMS:'} {diagnostics.httpStatus}</p>
            )}
            {diagnostics.message && <p>{diagnostics.message}</p>}
            {diagnostics.error && <p className="text-destructive">{diagnostics.error}</p>}
            {diagnostics.targets?.map((target, index) => (
              <div key={`${target.target_key}-${index}`} className="space-y-1 rounded border bg-background/60 p-2">
                <p className="font-medium text-foreground">
                  {target.target_key} · {target.status > 0 ? `HTTP ${target.status}` : english ? 'No response' : 'Keine Antwort'}
                </p>
                <p>{english ? 'Frontend:' : 'Frontend:'} <code>{target.endpoint}</code></p>
                <p>{english ? 'Path:' : 'Pfad:'} <code>{target.path}</code></p>
                <p>{target.message}</p>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
