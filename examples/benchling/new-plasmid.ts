import { kaja } from "kaja";
import { DNASequences, Folders, Projects } from "benchling";

const name = await kaja.askStr("What is the plasmid called?");
const bases = (await kaja.askStr("Paste its bases")).replace(/[^A-Za-z]/g, "").toUpperCase();
if (!/^[ACGTN]+$/.test(bases)) throw new Error("Those bases are not DNA.");

const { projects } = await Projects.ListProjects({ archiveReason: "NOT_ARCHIVED", sort: "name:asc", pageSize: 100 });
const projectId = await kaja.askSelect(
  "Which project?",
  projects.map((project) => ({ label: project.name, value: project.id })),
);

const { folders } = await Folders.ListFolders({ projectId, archiveReason: "NOT_ARCHIVED", sort: "name:asc", pageSize: 100 });
const folderId = await kaja.askSelect(
  "Which folder?",
  folders.map((folder) => ({ label: folder.name, value: folder.id })),
);

const plasmid = await kaja.approve(DNASequences.CreateDNASequence({ name, bases, isCircular: true, folderId }));

kaja.text(`${plasmid.name} is in Benchling: ${plasmid.length.toLocaleString()} bp, circular. ${plasmid.webUrl}`);

kaja.table([{ next: "See what Benchling made of it", open: kaja.run("sequence", { id: plasmid.id }) }]);
