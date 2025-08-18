import { GearIcon } from "@primer/octicons-react";

interface ActivityBarProps {
  onCompilerClick: () => void;
}

export function ActivityBar({ onCompilerClick }: ActivityBarProps) {
  return (
    <>
      <style>
        {`
          .activity-bar-container {
            display: flex;
            align-items: center;
            padding: 8px 8px 8px 16px;
            border-bottom: 1px solid var(--borderColor-default);
            background-color: var(--bgColor-default);
          }
          
          .activity-bar-label {
            flex: 1;
            font-size: 12px;
            font-weight: 600;
            color: var(--fgColor-muted);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            user-select: none;
          }
          
          .activity-bar-button {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 28px;
            height: 28px;
            border: none;
            background: transparent;
            color: var(--fgColor-default);
            cursor: pointer;
            border-radius: 4px;
            transition: all 0.15s ease;
            opacity: 0.8;
          }
          
          .activity-bar-button:hover {
            opacity: 1;
            background-color: var(--bgColor-neutral-muted);
            transform: scale(1.05);
          }
          
          .activity-bar-button:active {
            background-color: var(--bgColor-accent-muted);
            transform: scale(0.98);
          }
        `}
      </style>
      <div className="activity-bar-container">
        <div className="activity-bar-label">Explorer</div>
        <button
          className="activity-bar-button"
          aria-label="Open Compiler"
          onClick={onCompilerClick}
          title="Compiler"
        >
          <GearIcon size={16} />
        </button>
      </div>
    </>
  );
}