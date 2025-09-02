Add new project form

- Add "+" project button in the side bar action bar, left from the compiler button
- On click, show new project form with three input fields:
  - Name
  - URL
  - Protocol (gRPC, Twirp)
  - Workspace
- When submitted, add to the projects list and run Compile for the new project
- Don't try updating the kaja.json file for now. We'll add that later.
