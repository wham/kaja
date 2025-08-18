import { BeakerIcon } from "@primer/octicons-react";

interface ActivityBarProps {
  onCompilerClick: () => void;
}

export function ActivityBar({ onCompilerClick }: ActivityBarProps) {
  return (
    <>
      <style>
        {`
          .activity-bar-button {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 24px;
            height: 24px;
            border: none;
            background: transparent;
            color: var(--fgColor-muted);
            cursor: pointer;
            border-radius: 3px;
            transition: background-color 0.1s, color 0.1s;
          }
          
          .activity-bar-button:hover {
            color: var(--fgColor-default);
            background-color: var(--bgColor-emphasis);
          }
          
          .activity-bar-button:active {
            background-color: var(--bgColor-accent-emphasis);
          }
        `}
      </style>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          justifyContent: "flex-end",
          backgroundColor: "transparent",
          alignItems: "center",
          padding: "8px 8px 8px 0",
        }}
      >
        <button
          className="activity-bar-button"
          aria-label="Open Compiler"
          onClick={onCompilerClick}
          title="Compiler"
        >
          <BeakerIcon size={14} />
        </button>
      </div>
    </>
  );
}