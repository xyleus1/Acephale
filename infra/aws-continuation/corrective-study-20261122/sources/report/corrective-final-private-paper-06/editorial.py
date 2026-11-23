
"""Source-only editorial transformation of already-computed corrective results."""
import re
ARMS=('base','neutral_memory_prefetch','acephale')
LABELS={'base':'base','neutral_memory_prefetch':'neutral memory prefetch','acephale':'goal-conditioned prefetch'}
def need(ok,message):
 if not ok:raise ValueError(message)
def primary_structure(text):
 start=text.index('## 5. Retained exploratory native evaluation')
 corrective=text.index('### 5.5 Corrective native results',start)
 limitations=text.index('## 6. Qualification corrections and limitations',corrective)
 reproducibility=text.index('## 7. Reproducibility',limitations)
 historical=text[start:corrective].replace('## 5. Retained exploratory native evaluation','## 7. Historical exploratory native evaluation',1)
 historical=re.sub(r'### 5\.([1-4]) ',r'### 7.\1 ',historical)
 historical=historical.replace('Figure 3. Development database reward','Figure 5. Historical development database reward')
 current=text[corrective:limitations]
 current=re.sub(r'^### 5\.5 Corrective native results(?:: pending)?','## 5. Corrective native evaluation',current,count=1)
 current=current.replace('Figure 4. Corrective development','Figure 3. Corrective development').replace('Figure 5. Corrective heldout','Figure 4. Corrective heldout')
 tail=text[reproducibility:].replace('## 7. Reproducibility','## 8. Reproducibility',1)
 return text[:start]+current+text[limitations:reproducibility]+historical+tail
def completed_scope(text):
 replacements=[
 ("Native execution is planned as one original 18-run development segment per predictor seed, in the original seed-29 then seed-17 segment order, followed by the two original 48-run held-out segments.",
  "The corrective execution comprises two completed 18-run development segments and two completed 48-run held-out segments, one per predictor seed in each stage. Independent seed segments overlap on two qualified L40S hosts; original within-segment run order and cache behavior are preserved. Segment identities and claim-order requirements do not imply serial wall-clock execution across the two hosts."),
 ("The completed development audit is reported in Section 5.1.","The historical development audit is reported in Section 7.1; the corrective evaluated path is reported in Section 5."),
 ("Final reporting will use the observed timing-validity flags and reason codes, recorded model events, persisted telemetry and original estimators.","The final reporting uses observed timing-validity flags and reason codes, recorded model events, actual telemetry-closure dispositions and the unchanged original estimators."),
 ("Under the retained opportunity estimates, faster prediction alone cannot make the configured admission bound positive.","Under the historical failed-profile opportunity estimates, faster prediction alone cannot make that historical configured admission bound positive."),
 ("An executed or prepared profile is not assumed to have passed.","Both completed fixed80 profiles passed the unchanged minimum10 aggregation requirement, retaining 33 valid pairs and 47 measured actor-read misses per seed. Failed profile rows remain in the declared coverage denominator; the scheduler estimates are conditional on the valid pairs.")
 ]
 for before,after in replacements:
  need(text.count(before)==1,'Completed-scope marker differs: '+before[:70])
  text=text.replace(before,after,1)
 return text
def stage_sentence(report):
 arms=report['nativeCompletionAndLiveLatency']['arms']
 statuses='; '.join(LABELS[a]+': '+', '.join(str(n)+' '+status for status,n in sorted(arms[a]['status_counts'].items()))for a in ARMS)
 rewards='; '.join(LABELS[a]+' '+str(arms[a]['successes'])+'/'+str(arms[a]['scheduled_trials'])for a in ARMS)
 timings=', '.join(LABELS[a]+' '+str(arms[a]['latency_samples'])+'/'+str(arms[a]['scheduled_trials'])for a in ARMS)
 extra=report['additionalArmMetrics']
 clean='; '.join(LABELS[a]+' '+('unavailable'if extra[a]['knownConstraintCleanPass1']is None else format(100*extra[a]['knownConstraintCleanPass1'],'.1f')+'%')for a in ARMS)
 audits=', '.join(LABELS[a]+' '+str(extra[a]['constraintAuditCompleteTrials'])+'/'+str(arms[a]['scheduled_trials'])for a in ARMS)
 return ('The corrective '+report['stage']+' report retains all '+str(report['declaredSlots'])+' declared slots ('+statuses+'). '
         'Database-reward successes are '+rewards+'. Distinct known constraint-clean trial rates are '+clean+' (audits available: '+audits+'). Original valid live-latency samples are '+timings+'.')
def final_text(text,reports):
 need(set(reports)=={'development','heldout'},'Both actual corrective original reports required; no provisional final abstract')
 for stage,count in (('development',36),('heldout',96)):
  report=reports[stage]
  need(report.get('stage')==stage and report.get('declaredSlots')==count,'Original stage/denominator differs')
  need(set(report['nativeCompletionAndLiveLatency']['arms'])==set(ARMS),'Original three arms required')
  for arm in ARMS:
   row=report['nativeCompletionAndLiveLatency']['arms'][arm]
   need(sum(row['status_counts'].values())==row['scheduled_trials'],'Retained status denominator differs')
 abstract_start=text.index('## Abstract')
 abstract_end=text.index('## 1. Question and scope',abstract_start)
 old=text[abstract_start+len('## Abstract'):abstract_end].strip()
 marker='The retained exploratory custom tau-compatible native attempt'
 need(marker in old,'Expected retained-attempt abstract marker')
 replay=old.split(marker,1)[0].strip()
 split=replay.index('In retained fixed-panel replay')
 framing=replay[:split].strip();replay_results=replay[split:].strip()
 native=stage_sentence(reports['development'])+' '+stage_sentence(reports['heldout'])
 exposure=[]
 for stage in ('development','heldout'):
  for arm,row in reports[stage]['nativeCompletionAndLiveLatency']['arms'].items():
   exposure.append(row['speculative_starts'])
 no_exposure=all(x['missing_trials']==0 and x['known_total']==0 for x in exposure)
 if no_exposure:
  interpretation='No speculative read started in any corrective arm. These results characterize the deployed admission policy and do not estimate the efficacy of executed speculative reads or establish a native goal-conditioning speedup.'
 else:
  interpretation='Actual treatment exposure and its missing-data limits are reported with the native results. Nominal arm labels alone do not establish auxiliary-predictor efficacy or a native goal-conditioning speedup.'
 fresh='## Abstract\n\n'+framing+' '+native+' '+replay_results+' '+interpretation+' Earlier exploratory attempts, including their failed prerequisites and service interruptions, are retained separately. This is a custom tau-compatible study, not a full official benchmark score.\n\n'
 text=text[:abstract_start]+fresh+text[abstract_end:]
 title_end=text.index('\n',text.index('# '))+1
 abstract_start=text.index('## Abstract')
 text=text[:title_end]+'\n**Corrective study results with retained protocol and deployment limitations.** The original 36-development/96-heldout design is the primary native analysis below. Earlier attempts and all recorded failures remain separately available. Full-study acceptance is not inferred from report generation.\n\n'+text[abstract_start:]
 text=completed_scope(primary_structure(text))
 old_profile='The separate prospective 80-row profile is intended to measure the qualified current deployment without pooling these failed profiles. Its actual aggregate is reported with the corrective results; the old bound is not an estimate of the new profile.'
 new_profile='The separate fixed80 cohorts were measured on the qualified deployments, retaining 33 valid pairs and 47 measured actor-read misses per predictor seed. Their conservative scheduler inputs are reported in Section 5 conditional on the 33 valid pairs. The failed historical profiles are not pooled with them, and the historical bound is not an estimate of the corrective deployment.'
 need(old_profile in text,'Historical profile-tense marker changed');text=text.replace(old_profile,new_profile,1)
 old_closing='This working source packet retains the existing figures and original analysis bindings and adds copied qualification/comparison values with explicit pending result slots. Final PDF rendering and publication await the actual corrective outputs and their evidence closure. Infrastructure/provider charges and hosted-model usage are reported separately. Recorded usage is not presented as a reconciled invoice.'
 new_closing='The reproducibility record retains the frozen models and family splits, exact run IDs and ordering, original analysis inputs and outputs, profile measurements, source identities, runtime events, archived telemetry proofs and failed prior attempts. The tables and figures in this report copy the completed original analyses; editorial assembly introduces no new estimates. Infrastructure/provider charges and hosted-model usage remain separate. Recorded usage is not presented as a reconciled invoice.'
 need(old_closing in text,'Expected provisional reproducibility closing');text=text.replace(old_closing,new_closing,1)
 text=text.replace('The actor is Qwen3.5-9B and the auxiliary predictor is Qwen3.5-0.8B.','The actor is Qwen3.5-9B [5] and the auxiliary predictor is Qwen3.5-0.8B [6].',1)
 text=text.replace('Serving uses the pinned vLLM 0.32.0 environment and BF16 configuration.','Serving uses the pinned vLLM 0.32.0 environment [7] and BF16 configuration. The retained training environment pins PyTorch, Transformers and the PEFT/TRL stack [8] [9] [10] [11] [12] [13].',1)
 text=text.replace('The native environment uses a pinned tau2-bench source','The native environment uses a pinned tau2-bench source',1)
 return text
