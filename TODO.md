Add new project form into the desktop app.

- When opening the desktop app, determine the user's home directory. Create folder ~/.kaja if it doesn't exist.
- Use ~/.kaja as the desktop app workspace folder
- Try loading config from ~/.kaja/kaja.json, if does not exists create an empty one
- Encapsulate most of the logic into api.LoadGetConfigurationResponse() so it's visible to the user in logs
- If isWailsEnvironment short "+" project button in the side bar action bar, left from the compiler button
- On click, show new project form with three input fields:
  - Project Name
  - URL
  - Protocol (gRPC, Twirp)
  - Upload proto files (use Wails API for file uploads)
- When submitted, create folder ~/.kaja/<project-name> and upload the proto files there
- Add project entry into ~/.kaja/kaja.json and recompile
