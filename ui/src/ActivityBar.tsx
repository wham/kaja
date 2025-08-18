import { FileCodeIcon } from "@primer/octicons-react";

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
            width: 32px;
            height: 32px;
            border: none;
            background: transparent;
            color: var(--fgColor-muted);
            cursor: pointer;
            border-radius: 4px;
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
          gap: 2,
          padding: "4px 8px",
          borderBottom: "1px solid var(--borderColor-default)",
          backgroundColor: "var(--bgColor-inset)",
          alignItems: "center",
          height: 40,
        }}
      >
        <button
          className="activity-bar-button"
          aria-label="Open Compiler"
          onClick={onCompilerClick}
          title="Compiler"
        >
          <FileCodeIcon size={16} />
        </button>
      </div>
    </>
  );
}