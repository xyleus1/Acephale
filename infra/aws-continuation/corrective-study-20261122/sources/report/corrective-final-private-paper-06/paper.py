"""Copy original computed values into a private working manuscript; no estimator."""
from pathlib import Path
import argparse,collections,hashlib,importlib.util,json,os,re,shutil,subprocess
def need(ok,m):
 if not ok:raise ValueError(m)
def ref(p):
 p=Path(p);b=p.read_bytes();return {'path':str(p.resolve()),'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)}
def raw(v):return (json.dumps(v,sort_keys=True,indent=2,allow_nan=False)+'\n').encode()
def checked(r,parse=True):
 b=Path(r['path']).read_bytes();need(hashlib.sha256(b).hexdigest()==r['sha256'],'Source changed');return json.loads(b)if parse else b
def save(p,v):p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(raw(v));return ref(p)
def module(r,n):
 checked(r,False);sp=importlib.util.spec_from_file_location(n,r['path']);m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m);return m
def figure_data(report,report_ref):
 arms=report['nativeCompletionAndLiveLatency']['arms'];extra=report['additionalArmMetrics'];rows=[]
 for arm in ['base','neutral_memory_prefetch','acephale']:
  a=arms[arm];e=extra[arm]
  rows.append({'arm':arm,'scheduled':a['scheduled_trials'],'rewardTrialRate':a.get('pass1'),'knownConstraintCleanTrialRate':e.get('knownConstraintCleanPass1'),'statusCounts':a.get('status_counts'),'validLatencySamples':a.get('latency_samples')})
 return {'kind':'copied-corrective-native-figure-data-v1','stage':report['stage'],'sourceReportSha256':report_ref['sha256'],'rows':rows,'statisticsRecomputed':False,'scientificAcceptanceAsserted':False,'caption':'Original stored trial rates, not family estimates or new intervals. Unknown audits and failed/censored slots remain in original denominators.'}

def profile_section(profiles,sources):
 findings=checked(sources['schedulerFindings'])
 checked(sources['schedulerParagraph'],False);checked(sources['schedulerObservation'],False)
 rows={str(row['predictorTrainingSeed']):row for row in findings['rows']}
 need(set(profiles)==set(rows),'Profile source identities differ')
 table=['| Predictor seed | Declared | Completed | Recorded profile failures | Original aggregate sampleCount |','|---|---:|---:|---:|---:|']
 estimates=['| Predictor seed | Actor lead (ms) | Prediction (ms) | Contention (ms) | Scheduling (ms) | Tool (ms) | Validation (ms) |','|---|---:|---:|---:|---:|---:|---:|']
 for seed,row in sorted(profiles.items()):
  original=rows[seed]
  need(row['profileReady']['sha256']==original['profileReady']['sha256'] and row['opportunity']['sha256']==original['opportunity']['sha256'],'Profile evidence differs from sealed scheduler inputs')
  need(row['declared']==original['declaredCount'] and row['sampleCount']==original['sampleCount'],'Profile denominators differ')
  table.append('| '+seed+' | '+' | '.join(str(row[k])for k in ('declared','completed','failed','sampleCount'))+' |')
  estimates.append('| '+seed+' | '+' | '.join(format(original['estimateMilliseconds'][k],'.3f')for k in ('actorLeadMs','predictionMs','contentionMs','schedulingMs','toolMs','validationMs'))+' |')
 return ('#### Corrective prospective opportunity measurements\n\n'+'\n'.join(table)+'\n\n'
  'The original minimum10 gate passed for these separate fixed80 profiles on the qualified deployments. Each profile retained 33 valid pairs and 47 measured actor-read misses among all 80 declared rows. The estimates below are conditional on those 33 valid pairs per predictor seed. Old20 profiles and pre-measurement setup failures are not pooled or relabeled. This is prefix-profile coverage, not task success.\n\n'
  'The original conservative estimator (lower benefits p10, upper costs p90) supplied the following scheduler inputs. These are copied profile-derived estimates, not new native latency or speedup estimates.\n\n'+'\n'.join(estimates)+'\n\n'
  'The estimated tool benefit is approximately 13 to 14 ms, prediction is about 1 s, and the contention estimate is larger still. The admission rule and thresholds remain unchanged. Final treatment exposure is reported from all retained native runtime events; an unexposed treatment arm does not establish the efficacy of executed speculative reads.\n\n'
  'Source-bound evidence: [original profile and observed-runtime proof bindings](corrective-results/scheduler-inputs-binding.json).')

def build(value,output):
 need(value['kind']=='acephale-corrective-private-paper-input-v1','Paper kind')
 out=Path(output);need(not out.exists(),'New paper output required');out.mkdir(parents=True)
 base=checked(value['baseDraftReady']);manifest=checked(base['manifest']);base_root=Path(value['baseDraftReady']['path']).parent
 source=out/'source';source.mkdir()
 for row in manifest['files']:
  rel=Path(row['path'])
  if rel.parts and rel.parts[0]=='source':
   p=base_root/rel;data=checked({'path':str(p),'sha256':row['sha256']},False)
   target=out/rel;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
 original=(source/'manuscript.md').read_text();text=original
 formatter=module(value['sources']['formatter'],'native_formatter')
 (source/'rendering/native_section.py').write_bytes(checked(value['sources']['formatter'],False))
 fidelity=module(value['sources']['fidelity'],'original_fidelity_reader')
 sections=[];report_refs={};bindings=[];figs=[];profiles={};insertions=checked(ref(source/"corrective-results/insertions.json"))
 for stage in ('development','heldout'):
  if stage not in value['analyses']:
   sections.append('#### Corrective '+stage+': pending\n\nNo closed original analysis has been incorporated for this stage. Numeric fields remain absent, not zero.')
   continue
  ar=checked(value['analyses'][stage]);checked(ar['source'],False)
  need(ar['source']['sha256']==value['sources']['originalAnalysis']['sha256'],'Original estimator source identity')
  report=checked(ar['nativeReport']);need(report['stage']==stage and report['declaredSlots']==(36 if stage=='development'else 96),'Original complete design denominator')
  inp=checked(ar['input']);reference=inp['nativeReference'];plan=checked(reference['plan'])
  owner=checked(inp['ownerCollection'])
  for execution in inp['correctiveExecutionEvidence']:
   preparation=checked(execution['sourcePreparation'])
   profile_ref=preparation['evidence']['profileEvidence'];profile=checked(profile_ref)
   receipt=checked(profile['profileReceipt']);opportunity=checked(profile['opportunity'])
   need(profile['profileValid']is True and receipt['closed']is True and receipt['readyForAggregation']is True and opportunity['sampleCount']>=10,'Actual profile aggregate required')
   profiles[str(profile['seed'])]={'declared':receipt['declared'],'completed':receipt['completed'],'failed':receipt['failed'],'sampleCount':opportunity['sampleCount'],'profileReady':profile_ref,'opportunity':profile['opportunity'],'receipt':profile['profileReceipt']}
  dest=source/'corrective-results'/stage;dest.mkdir(parents=True,exist_ok=True)
  (dest/'native-report.json').write_bytes(checked(ar['nativeReport'],False))
  report_refs[stage]=ref(dest/'native-report.json')
  data=figure_data(report,ar['nativeReport']);dr=save(dest/'figure-data.json',data)
  sections.append('#### Corrective '+stage+'\n\nThe following table copies the original statistical report for the separate corrective attempt. It retains all declared slots and does not replace the earlier exploratory results. Report generation alone does not assert scientific acceptance.\n\n'+formatter.render_native_section(report))
  evidence={'state':'unavailable','reason':'Required event evidence not yet verified'}
  try:
   need(all(owner.get('nativeRuntimeLogsComplete',[])) and len(owner.get('nativeRuntimeLogsComplete',[]))==2,'Collector reports incomplete original runtime logs')
   evidence=fidelity.inspect_cohorts(reference['cohorts'],[x['runId']for x in plan['originalRuns']],plan['originalRuns'])
   expected={(x['cohortReceiptSha256'],x['runtimeEventsSha256'])for x in evidence['cohorts']}
   actual={(x['cohortReceiptSha256'],x['runtimeEventsSha256'])for x in report['sources']}
   need(expected==actual,'Report/event source mismatch')
   evidence['state']='source-verified';evidence['statisticsRecomputed']=False
  except (FileNotFoundError,KeyError,ValueError)as exc:
   # Do not invent complete telemetry when closed outcomes contain missing logs.
   evidence={'state':'unavailable','reason':str(exc),'analysisRowsRetained':True,'statisticsRecomputed':False}
  er=save(dest/'evaluated-path-and-timing.json',evidence)
  if evidence['state']=='source-verified':
   counts=evidence['eventCounts'];suffix=evidence['localRequestIdsBySuffix']
   reason=collections.Counter(sample.get('reason')or'unspecified'for row in evidence['rows']for sample in row['hostHealthSamples'])
   timing={k:v['validTimingRows']for k,v in evidence['perArmCounts'].items()}
   wording='Recorded event totals: '+', '.join(k+'='+str(counts.get(k,0))for k in ('model_dispatch','model_completed','infra_checkpoint','infra_opportunity_rejected'))+'. Request-type suffix counts are '+json.dumps(suffix,sort_keys=True)+'.'
   wording+=' Valid timing rows by arm: '+json.dumps(timing,sort_keys=True)+'. Recorded host-health reason counts: '+json.dumps(dict(reason),sort_keys=True)+'.'
   wording+=' These are direct log/row counts, not a new statistical estimator. Configuration alone does not establish retrieval or auxiliary prediction. Actual seed identities and raw per-segment hardware/runtime provenance are retained in the companion evidence.'
  else:wording='Live-path/host-observation evidence remains incomplete: '+evidence['reason']+'. No positive timing or auxiliary-prediction claim is inferred.'
  exposure={arm:{key:metrics[key] for key in ('speculative_starts','useful_speculations')} for arm,metrics in report['nativeCompletionAndLiveLatency']['arms'].items()}
  save(dest/'treatment-exposure.json',{'originalReport':ar['nativeReport'],'copiedOriginalSchedulerMetrics':exposure,'statisticsRecomputed':False})
  if all(row['speculative_starts']['missing_trials']==0 and row['speculative_starts']['known_total']==0 for row in exposure.values()):
   wording+=' All arms recorded zero speculative starts in the original report. These results do not estimate the efficacy of executed speculative tool reads.'
  wording+=' Nominal treatment assignment alone does not establish retrieval or auxiliary-predictor execution. Arm contrasts describe the deployed admission policy under the observed workload; claims about the efficacy of executed speculation require corresponding observed exposure. No superiority claim is inferred from an unexposed treatment label.'
  sections.append(wording)
  fdir=source/'figures'/('corrective-'+stage);fdir.parent.mkdir(parents=True,exist_ok=True)
  env=dict(os.environ);env['LD_LIBRARY_PATH']='/REQUIRED_BINDINGS/research-root/workspaces/report/locked-environments-02/python-root/local/lib'
  cmd=['/REQUIRED_BINDINGS/research-root/workspaces/report/locked-environments-02/analysis5a/bin/python','-I','-B',value['sources']['plot']['path'],'--data',dr['path'],'--sha256',dr['sha256'],'--output',str(fdir)]
  result=subprocess.run(cmd,capture_output=True,text=True,env=env,timeout=120)
  save(out/('figure-'+stage+'-command.json'),{'argv':cmd,'returncode':result.returncode,'stdout':result.stdout,'stderr':result.stderr})
  need(result.returncode==0,'Copied-value figure failed')
  figs.append(ref(fdir/'rates.png'))
  sections.append('![Corrective '+stage+' stored trial rates](figures/corrective-'+stage+'/rates.png)\n\nFigure '+('4'if stage=='development'else'5')+'. Corrective '+stage+' original stored reward and known constraint-clean trial rates. Failed/censored slots and unknown audits retain their original denominators; this figure adds no confidence interval or equivalence claim.')
  bindings.append({'stage':stage,'analysisReady':value['analyses'][stage],'originalReport':ar['nativeReport'],'reportCopy':report_refs[stage],'scopeBinding':ar['scopeBinding'],'pathEvidence':er,'figureData':dr})
  insertions['stages'][stage].update(state='original-analysis-present',observedCounts={arm:data.get('status_counts')for arm,data in report['nativeCompletionAndLiveLatency']['arms'].items()},metrics=report_refs[stage],reason=None)
 if profiles:
  for seed,row in sorted(profiles.items()):
   insertions['profiles'][seed]={'declared':row['declared'],'observedCounts':{k:row[k]for k in ('completed','failed')},'aggregate':row['opportunity']}
  sections.insert(0,profile_section(profiles,value['sources']))
  save(source/'corrective-results/prospective-profile-values.json',profiles)
  evidence={key:value['sources'][key]for key in ('schedulerFindings','schedulerParagraph','schedulerObservation')}
  evidence['actualProfileBindings']=profiles
  evidence['actualQualificationBindings']={seed:checked(row['profileReady'])['actualQualification']for seed,row in profiles.items()}
  evidence['statisticsRecomputed']=False
  save(source/'corrective-results/scheduler-inputs-binding.json',evidence)
  for key,name in (('schedulerFindings','scheduler-inputs-original.json'),('schedulerParagraph','scheduler-inputs-original-paragraph.md'),('schedulerObservation','scheduler-runtime-observation.json')):
   (source/'corrective-results'/name).write_bytes(checked(value['sources'][key],False))
 if value.get('finalTelemetry') is not None:
  need(set(value['analyses'])=={'development','heldout'},'Both original completed analyses required for final telemetry presentation')
  telemetry=module(value['sources']['telemetry'],'final_telemetry_reader')
  final_evidence=telemetry.build(value['finalTelemetry'],value['analyses'])
  save(source/'corrective-results/final-telemetry-closure.json',final_evidence)
  sections.append(final_evidence['paragraph'])
 else:
  sections.append('Persisted telemetry/archive verification and dated financial closure remain separate evidence requirements. Recorded hosted usage is not an invoice. This private artifact requires ROOT final review; complete slot coverage is not a full-study acceptance assertion.')
 begin='<!-- CORRECTIVE_NATIVE_RESULTS_BEGIN -->';end='<!-- CORRECTIVE_NATIVE_RESULTS_END -->'
 need(text.count(begin)==text.count(end)==1,'Insertion marker')
 a=text.index(begin)+len(begin);b=text.index(end,a);text=text[:a]+'\n'+'\n\n'.join(sections)+'\n'+text[b:]
 text=text.replace('### 5.5 Corrective native results: pending','### 5.5 Corrective native results')
 if report_refs:
  text=text.replace('**Working manuscript; corrective native evaluation is pending.**','**Working manuscript; corrective results are reported below and final evidence review remains pending.**')
  text=text.replace('No corrective native score or speedup is reported in this draft.','Corrective stored metrics are reported separately below; no speedup or full-study completion is asserted automatically.')
  text=text.replace('Prospective opportunity measurements and a separate corrective execution of the original 36/96 native design remain pending in this manuscript.','Available original analyses for the separate corrective 36/96 native design are presented below; missing stages and evidence are explicitly marked pending.')
  text=text.replace('The corrective development and held-out result collections have not been incorporated into this draft.','Available corrective collections are incorporated below.')
  text=text.replace('Its result is pending here; the old bound is not an estimate of that future profile.','Its actual aggregate is reported with the corrective results; the old bound is not an estimate of the new profile.')
  text=text.replace('Its result is pending here','Its actual aggregate is reported with the corrective results')
  text=text.replace('Its result is pending here;', 'Its actual aggregate is reported with the corrective results;')
  text=text.replace('Its result is pending here', 'Its actual aggregate is reported with the corrective results')
  text=text.replace('its result is pending here; the old bound is not an estimate of that future profile.','its actual aggregate is reported with the corrective results; the old bound is not an estimate of the new profile.')
 need(set(value['analyses'])=={'development','heldout'},'Final editorial source requires both actual corrective analyses')
 editorial=module(value['sources']['editorial'],'final_editorial05')
 text=editorial.final_text(text,{stage:checked(report_refs[stage])for stage in ('development','heldout')})
 (source/'references.bib').write_bytes(checked(value['sources']['bibliography'],False))
 (source/'rendering/assemble.py').write_bytes(checked(value['sources']['assembly'],False))
 (source/'rendering/editorial.py').write_bytes(checked(value['sources']['editorial'],False))
 (source/'rendering/plot_copied.py').write_bytes(checked(value['sources']['plot'],False))
 (source/'corrective-results/replay-metric-label-audit.json').write_bytes(checked(value['sources']['replayLabelAudit'],False))
 methods=(source/'methods.md').read_text().replace('Appendix scope for this working draft','Appendix scope for this report')
 (source/'methods.md').write_text(methods)
 related=(source/'related-work.md').read_text()
 related=related.replace('The native environment is pinned to tau2-bench commit','The tau2-bench environment paper [3] and pinned upstream source [4] provide the native provenance. The native environment is pinned to tau2-bench commit',1)
 (source/'related-work.md').write_text(related)
 save(source/'corrective-results/editorial-binding.json',{'analysesUnchanged':value['analyses'],'editorialSource':value['sources']['editorial'],'bibliography':value['sources']['bibliography'],'assembly':value['sources']['assembly'],'replayLabelAudit':value['sources']['replayLabelAudit'],'statisticsInvoked':False,'historicalOutcomesPreserved':True,'primaryAnalysis':'corrective36-and96'})
 save(source/'corrective-results/insertions.json',insertions)
 (source/'manuscript.md').write_text(text)
 save(source/'corrective-results/current-analysis-bindings.json',{'bindings':bindings,'copiedValuesOnly':True,'studyComplete':False,'canonicalAcceptanceAsserted':False,'pendingStages':[s for s in ('development','heldout')if s not in report_refs]})
 # Existing original renderer/assembly scripts are pinned by base source manifest.
 commands=[]
 for label,script,args in [('assemble',source/'rendering/assemble.py',['--source',str(source),'--output',str(out/'assembled')]),('render',source/'rendering/render.py',['--source',str(out/'assembled'),'--output',str(out/'rendered')])]:
  command=[os.sys.executable,'-B',str(script)]+args;v=subprocess.run(command,capture_output=True,text=True,timeout=180)
  cr=save(out/(label+'-command.json'),{'argv':command,'returncode':v.returncode,'stdout':v.stdout,'stderr':v.stderr});commands.append(cr);need(v.returncode==0,'Original '+label+' failed')
 import fitz
 pdf=out/'rendered/acephale-working-manuscript.pdf';document=fitz.open(pdf);previews=out/'review';previews.mkdir();violations=[];pages=[]
 for n,page in enumerate(document):
  for block in page.get_text('dict')['blocks']:
   for line in block.get('lines',[]):
    for span in line.get('spans',[]):
     x0,y0,x1,y1=span['bbox']
     if min(x0,y0)<-.5 or x1>page.rect.width+.5 or y1>page.rect.height+.5:violations.append({'page':n+1,'bbox':span['bbox']})
  pp=previews/('page-%03d.png'%(n+1));page.get_pixmap(matrix=fitz.Matrix(1,1),alpha=False).save(pp);pages.append(ref(pp))
 document.close();need(not violations,'Rendered text outside page bounds')
 save(out/'LAYOUT.json',{'pages':len(pages),'textOutsidePages':violations,'previews':pages,'humanVisualReviewCompleted':False})
 ready={'kind':'acephale-corrective-private-working-paper-v1','pdf':ref(pdf),'editable':ref(source/'manuscript.md'),'sourceDirectory':str(source),'analysisBindings':ref(source/'corrective-results/current-analysis-bindings.json'),'figures':figs,'layout':ref(out/'LAYOUT.json'),'sourceInputs':value,'artifactPrepared':True,'directCoverageStages':list(report_refs),'studyComplete':False,'scientificAcceptanceAsserted':False,'publicPublication':False,'requiresRootVisualAndFinalReview':True}
 save(out/'READY.json',ready);return ready
def main():
 p=argparse.ArgumentParser();p.add_argument('--inputs',required=True);p.add_argument('--sha256',required=True);p.add_argument('--output',required=True);a=p.parse_args()
 v=build(checked({'path':a.inputs,'sha256':a.sha256}),a.output);print(json.dumps({'ready':ref(Path(a.output)/'READY.json'),'pdf':v['pdf']}))
if __name__=='__main__':main()
