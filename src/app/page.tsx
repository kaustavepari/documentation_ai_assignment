export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-md space-y-2 text-center">
        <h1 className="text-lg font-medium">Notes</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          The note tree and editor land in the next phase. Until then,{' '}
          <a href="/api/health" className="underline underline-offset-4">
            /api/health
          </a>{' '}
          reports which files the app sees and how they compare to{' '}
          <code className="font-mono text-[0.9em]">.noteindex.json</code>.
        </p>
      </div>
    </main>
  );
}
