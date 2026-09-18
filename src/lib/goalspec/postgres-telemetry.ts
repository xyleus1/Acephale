import { Prisma, type PrismaClient } from "@prisma/client";
import { hash } from "./canonical";
import { resolveSource, validateGoals } from "./compiler";
import type { Candidate, EvidenceEnvelope, ExecutionFrame, ExperimentManifest, GoalSet, Outcome } from "./contracts/generated";
import { validateContract } from "./contracts/validate";

export interface FrameRecord { frame: ExecutionFrame; provenance: "runtime" | "reconstructed_native_prefix"; inputHash?: string; goals?: GoalSet; evidence: EvidenceEnvelope[] }
export interface CandidateRecord { candidate: Candidate; boundary: number; visibleInputHash: string; admission: string; reason?: string; observedTool?: string; failureCause?: string; supportingEvents?: unknown[] }
export interface RunTelemetry {
  runId: string; experiment: ExperimentManifest; arm: "base" | "neutral" | "goalspec";
  nativeArtifactHash: string; nativeArtifactUri: string; phase: string;
  events: { type: string; payload: unknown; artifactUri: string }[];
  frames: FrameRecord[]; candidates: CandidateRecord[]; outcome: Outcome;
  independentEvidence: Record<string, unknown>;
}

/** Import completed runs transactionally. The event stream and verdict cannot be rewritten. */
export class PostgresTelemetryStore {
  constructor(private db: PrismaClient) {}
  async importRun(run: RunTelemetry) {
    validateContract("ExperimentManifest", run.experiment); validateContract("Outcome", run.outcome);
    if (run.outcome.runId !== run.runId || !/^[a-f0-9]{64}$/.test(run.nativeArtifactHash) || new Set(run.frames.map(row => row.frame.boundary)).size !== run.frames.length) throw new Error("Invalid run telemetry identity");
    const frames = new Map(run.frames.map(row => [row.frame.boundary, row]));
    for (const row of run.frames) {
      validateContract("ExecutionFrame", row.frame);
      if (row.frame.runId !== run.runId || row.frame.snapshotId !== run.experiment.snapshotId) throw new Error("Telemetry frame scope mismatch");
      validateGoals(row.goals ?? row.frame.goals, row.frame.sources);
      for (const evidence of row.evidence) {
        validateContract("EvidenceEnvelope", evidence);
        if (evidence.observationHash !== hash(evidence.observation) || hash(evidence.invocation.scope) !== hash(row.frame.scope)) throw new Error("Telemetry evidence scope or hash mismatch");
      }
    }
    for (const row of run.candidates) {
      validateContract("Candidate", row.candidate);
      const frame = frames.get(row.boundary)?.frame;
      if (!frame || !/^[a-f0-9]{64}$/.test(row.visibleInputHash)) throw new Error("Candidate telemetry has no current frame");
      // Rejected proposals are necessary prediction-error evidence. Preserve
      // their invalid scope/reference without admitting them to runtime reuse.
      if (row.admission === "admitted") {
        if (hash(row.candidate.invocation.scope) !== hash(frame.scope)) throw new Error("Admitted candidate telemetry has incompatible scope");
        row.candidate.bindings.forEach(reference => resolveSource(reference, frame.sources));
      }
    }
    const importHash = hash(run);
    return this.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(72489102)`;
      const previous = await tx.$queryRaw<{ manifest: { importHash: string } }[]>(Prisma.sql`SELECT manifest FROM goalspec.run_manifest WHERE id=${run.runId}`);
      if (previous.length) {
        if (previous[0].manifest.importHash !== importHash) throw new Error("Immutable run telemetry conflict");
        return { runId: run.runId, existing: true, events: run.events.length, frames: run.frames.length, candidates: run.candidates.length };
      }
      const snapshot = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM goalspec.repository_snapshot WHERE id=${run.experiment.snapshotId} AND publication_state='frozen'`);
      if (snapshot.length !== 1) throw new Error("Run telemetry requires its frozen repository snapshot");
      await tx.$executeRaw(Prisma.sql`INSERT INTO goalspec.run_manifest(id,snapshot_id,experiment_kind,arm,manifest)
        VALUES(${run.runId},${run.experiment.snapshotId},'live_native',${run.arm},${JSON.stringify({ contract: run.experiment, importHash, nativeArtifactHash: run.nativeArtifactHash, nativeArtifactUri: run.nativeArtifactUri, phase: run.phase })}::jsonb)`);
      for (let offset = 0; offset < run.events.length; offset += 100) {
        const rows = run.events.slice(offset, offset + 100).map((event, index) => ({ seq: offset + index, type: event.type, payload: event.payload, artifactUri: event.artifactUri }));
        await tx.$executeRaw(Prisma.sql`INSERT INTO goalspec.execution_event(run_id,seq,trace_id,event_type,event,artifact_uri)
          SELECT ${run.runId}, x.seq, ${run.runId}, x.type, x.payload, x."artifactUri"
          FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS x(seq bigint,type text,payload jsonb,"artifactUri" text)`);
      }
      for (const row of run.frames) {
        const frame = row.frame, goals = row.goals ?? frame.goals;
        await tx.$executeRaw(Prisma.sql`INSERT INTO goalspec.execution_frame(run_id,boundary,frame_hash,input_hash,provenance,frame)
          VALUES(${run.runId},${frame.boundary},${hash(frame)},${row.inputHash ?? null},${row.provenance},${JSON.stringify(frame)}::jsonb)`);
        await tx.$executeRaw(Prisma.sql`INSERT INTO goalspec.goal_hypothesis(run_id,boundary,revision_hash,goals)
          VALUES(${run.runId},${frame.boundary},${goals.revisionHash},${JSON.stringify(goals)}::jsonb)`);
        for (const evidence of row.evidence) await tx.$executeRaw(Prisma.sql`INSERT INTO goalspec.evidence_observation(run_id,boundary,evidence_id,evidence_hash,evidence)
          VALUES(${run.runId},${frame.boundary},${evidence.id},${hash(evidence)},${JSON.stringify(evidence)}::jsonb)`);
      }
      for (const [index, row] of run.candidates.entries()) {
        const id = hash({ runId: run.runId, index, row });
        await tx.$executeRaw(Prisma.sql`INSERT INTO goalspec.prediction_record(id,run_id,boundary,visible_input_hash,candidate,admission,reason)
          VALUES(${id},${run.runId},${row.boundary},${row.visibleInputHash},${JSON.stringify(row.candidate)}::jsonb,${row.admission},${row.reason ?? null})`);
        if (row.failureCause) await tx.$executeRaw(Prisma.sql`INSERT INTO goalspec.prediction_confusion(id,run_id,predicted_class,observed_class,failure_cause,supporting_events)
          VALUES(${id},${run.runId},${row.candidate.invocation.tool},${row.observedTool ?? "none"},${row.failureCause},${JSON.stringify(row.supportingEvents ?? [])}::jsonb)`);
      }
      await tx.$executeRaw(Prisma.sql`INSERT INTO goalspec.outcome_verdict(run_id,verifier_version,requested_objective,inferred_objectives,achieved_outcomes,independent_verdict)
        VALUES(${run.runId},${run.outcome.independentVerdict.verifierId},${JSON.stringify(run.outcome.requestedObjective)}::jsonb,${JSON.stringify(run.outcome.inferredGoals)}::jsonb,
          ${JSON.stringify(run.outcome.achievedOutcomes)}::jsonb,${JSON.stringify({ ...run.outcome.independentVerdict, evidence: run.independentEvidence })}::jsonb)`);
      return { runId: run.runId, existing: false, events: run.events.length, frames: run.frames.length, candidates: run.candidates.length };
    }, { timeout: 120_000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
  async exportRun(runId: string) {
    const manifest = await this.db.$queryRaw(Prisma.sql`SELECT * FROM goalspec.run_manifest WHERE id=${runId}`);
    if (!Array.isArray(manifest) || manifest.length !== 1) throw new Error("Unknown run export");
    return { manifest,
      events: await this.db.$queryRaw(Prisma.sql`SELECT seq::integer,event_type,event,artifact_uri FROM goalspec.execution_event WHERE run_id=${runId} ORDER BY seq`),
      frames: await this.db.$queryRaw(Prisma.sql`SELECT boundary::integer,frame_hash,input_hash,provenance,frame FROM goalspec.execution_frame WHERE run_id=${runId} ORDER BY boundary`),
      goals: await this.db.$queryRaw(Prisma.sql`SELECT boundary::integer,revision_hash,goals FROM goalspec.goal_hypothesis WHERE run_id=${runId} ORDER BY boundary`),
      evidence: await this.db.$queryRaw(Prisma.sql`SELECT boundary::integer,evidence_id,evidence_hash,evidence FROM goalspec.evidence_observation WHERE run_id=${runId} ORDER BY boundary,evidence_id`),
      candidates: await this.db.$queryRaw(Prisma.sql`SELECT id,boundary::integer,visible_input_hash,candidate,admission,reason FROM goalspec.prediction_record WHERE run_id=${runId} ORDER BY boundary,id`),
      confusions: await this.db.$queryRaw(Prisma.sql`SELECT * FROM goalspec.prediction_confusion WHERE run_id=${runId} ORDER BY id`),
      outcome: await this.db.$queryRaw(Prisma.sql`SELECT * FROM goalspec.outcome_verdict WHERE run_id=${runId}`) };
  }
}
