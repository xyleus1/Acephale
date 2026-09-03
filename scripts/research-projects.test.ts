import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import {
  assignResearchListProject,
  createResearchList,
} from "../src/lib/research-lists";
import {
  createResearchProject,
  ensureResearchProject,
  listResearchProjects,
} from "../src/lib/research-projects";

async function main() {
  const suffix = randomUUID().slice(0, 8);
  const office = await prisma.office.create({ data: { name: `Research projects ${suffix}` } });
  const otherOffice = await prisma.office.create({ data: { name: `Research projects other ${suffix}` } });
  try {
    const project = await createResearchProject(office.id, {
      name: "Steel buyers",
      description: "Priority segment",
    });
    assert.equal(project.slug, "steel-buyers");
    assert.equal(project.description, "Priority segment");
    assert.equal((await listResearchProjects(office.id))[0]?.id, project.id);

    const list = await createResearchList(office.id, {
      name: "Spring prospects",
      fields: [{ key: "company_name", label: "Company", type: "text" }],
      projectId: project.id,
    });
    assert.equal(list.projectId, project.id);
    assert.equal((await listResearchProjects(office.id))[0]?.listCount, 1);

    const otherProject = await createResearchProject(otherOffice.id, { name: "Other workflow" });
    await assert.rejects(
      () => createResearchList(office.id, {
        name: "Cross-office list",
        fields: [{ key: "company_name", label: "Company", type: "text" }],
        projectId: otherProject.id,
      }),
      /invalid/,
    );
    await assert.rejects(
      () => assignResearchListProject(office.id, list.id, otherProject.id),
      /invalid/,
    );

    const ensured = await ensureResearchProject(office.id, { name: "Steel buyers" });
    assert.equal(ensured.id, project.id);
    assert.equal((await listResearchProjects(otherOffice.id))[0]?.id, otherProject.id);

    const unassigned = await assignResearchListProject(office.id, list.id, null);
    assert.equal(unassigned.projectId, null);
    const reassigned = await assignResearchListProject(office.id, list.id, project.id);
    assert.equal(reassigned.projectId, project.id);
  } finally {
    await prisma.office.delete({ where: { id: otherOffice.id } });
    await prisma.office.delete({ where: { id: office.id } });
  }
  console.log("Research projects contract passed.");
}

void main();
