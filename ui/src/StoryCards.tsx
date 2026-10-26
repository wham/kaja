import { cn } from "./cn";
import { Spinner } from "./components/spinner";
import { Draft, findStoryDraft } from "./drafts";
import { Story, StoryCollection, storyId, storyServices } from "./stories";

// The stories whose draft has a run in flight.
export function runningStories(collection: StoryCollection, appName: string, drafts: Draft[], runningFiles: Set<string>): Set<string> {
  return new Set(
    collection.stories
      .filter((story) => {
        const draft = findStoryDraft(drafts, storyId(collection, story), appName);
        return draft !== undefined && runningFiles.has(draft.id);
      })
      .map((story) => story.name),
  );
}

interface StoryGridProps {
  collection: StoryCollection;
  running: Set<string>;
  phone: boolean;
  onOpenStory: (story: Story) => void;
}

export function StoryGrid({ collection, running, phone, onOpenStory }: StoryGridProps) {
  return (
    <div
      className={cn(
        phone
          ? "-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          : "grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3",
      )}
    >
      {collection.stories.map((story) => (
        <StoryCard
          key={story.name}
          story={story}
          services={storyServices(collection, story)}
          running={running.has(story.name)}
          phone={phone}
          onOpen={() => onOpenStory(story)}
        />
      ))}
    </div>
  );
}

function StoryCard({ story, services, running, phone, onOpen }: { story: Story; services: string[]; running: boolean; phone: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex min-h-[112px] flex-col gap-1 rounded-lg border border-border bg-card p-3 text-left outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring",
        phone ? "w-[80%] shrink-0 snap-start" : "w-full",
      )}
    >
      <span className="flex items-center gap-2">
        <span className="truncate text-sm font-medium text-foreground">{story.title}</span>
        {running && <Spinner size="sm" className="shrink-0 text-muted-foreground" />}
      </span>
      <span className="line-clamp-2 text-xs text-muted-foreground">{story.summary}</span>
      <span className="mt-auto flex flex-wrap gap-1 pt-2">
        {services.map((service) => (
          <span key={service} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
            {service}
          </span>
        ))}
      </span>
    </button>
  );
}
