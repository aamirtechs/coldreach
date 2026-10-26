import { Clock3 } from "lucide-react";

interface PhasePlaceholderProps {
  title: string;
  phase: string;
  description: string;
  bullets: string[];
}

/**
 * Honest placeholder for areas that land in a later phase. It describes
 * exactly what will be built and contains no fake data or dead controls.
 */
export function PhasePlaceholder({ title, phase, description, bullets }: PhasePlaceholderProps) {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight">{title}</h1>
        <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent">
          <Clock3 className="h-3.5 w-3.5" />
          Arrives in {phase}
        </span>
      </div>
      <p className="mt-3 leading-relaxed text-muted">{description}</p>
      <div className="card mt-6 p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Planned for this area
        </h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed">
          {bullets.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
