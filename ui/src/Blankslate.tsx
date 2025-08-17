export function Blankslate() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        background: "var(--bgColor-canvas-default)",
      }}
    >
      <h1
        style={{
          fontSize: 24,
          marginTop: 16,
          color: "var(--fgColor-default)",
        }}
      >
        Welcome to kaja
      </h1>
      <p
        style={{
          fontSize: 16,
          marginTop: 8,
          color: "var(--fgColor-muted)",
        }}
      >
        Select a method from the sidebar to get started.
      </p>
    </div>
  );
}
