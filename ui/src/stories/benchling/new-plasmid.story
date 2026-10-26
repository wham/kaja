import { kaja } from "kaja";
import { DnaSequence, Folder, Project } from "benchling";

const name = await kaja.askStr("What is the plasmid called?");
const bases = (await kaja.askStr("Paste its bases")).replace(/[^A-Za-z]/g, "").toUpperCase();
if (!/^[ACGTN]+$/.test(bases)) throw new Error("Those bases are not DNA.");

const { items: projects } = await Project.List({ pageSize: 100 });
const projectId = await kaja.askSelect(
  "Which project?",
  projects.sort((a, b) => a.name.localeCompare(b.name)).map((project) => ({ label: project.name, value: project.id })),
);

const { items: folders } = await Folder.List({ projectEq: projectId, pageSize: 100 });
const folderId = await kaja.askSelect(
  "Which folder?",
  folders.sort((a, b) => a.name.localeCompare(b.name)).map((folder) => ({ label: folder.name, value: folder.id })),
);

const plasmid = await kaja.approve(DnaSequence.Create({ name, bases, isCircular: true, folderId }));

kaja.text(`${plasmid.name} is in Benchling: ${plasmid.bases.length.toLocaleString()} bp, circular.`);

kaja.table([{ next: "See what Benchling made of it", open: kaja.run("sequence", { id: plasmid.id }) }]);
