export function Blankslate() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        padding: 32,
      }}
    >
      <h1
        style={{
          fontSize: "var(--text-title-size-large)",
          margin: 0,
          marginBottom: 8,
          color: "var(--fgColor-default)",
        }}
      >
        Welcome to kaja
      </h1>
      <p
        style={{
          fontSize: "var(--text-body-size-large)",
          margin: 0,
          color: "var(--fgColor-muted)",
        }}
      >
        Select a method from the sidebar to get started.
      </p>
    </div>
  );
}
