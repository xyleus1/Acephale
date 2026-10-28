# Paired legacy checkpoint comparison

Same 213 archived checkpoints and 109 unchanged automated teacher references. This is v2 development evidence, not fresh confirmation.

| Metric | v1 | v2 | Raw paired change |
| --- | ---: | ---: | ---: |
| Valid | 1/213 | 213/213 | +0.995305 |
| SemanticTop1 | 0/213 | 171/213 | +0.802817 |
| SemanticTop3 | 0/213 | 171/213 | +0.802817 |

Paired family intervals and all seven prediction conditions plus their seven identical-pool controls are in summary.json. Raw checkpoint means and family-weighted interval estimates use different weights. Original v1 failures remain misses; validity is separate from semantic completeness.

Visible inputs, targets, unchanged baseline predictions, and identical candidate pools were verified. Endpoint-label matches, including unknown matches, remain separate from teacher-scored requested-goal accuracy.

## Seven frozen prediction conditions

All entries use 213 checkpoints. Full-argument accuracy requires the correct tool and the complete current argument object.

| Condition | Tool top-1 | Tool top-3 | Full args top-1 | Full args top-3 | Tool NLL | Action NLL |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| stateless | 36/213 (0.169014) | 70/213 (0.328638) | 0/213 (0.000000) | 0/213 (0.000000) | 2.637135236 | 27.631021116 |
| local_paste | 83/213 (0.389671) | 135/213 (0.633803) | 38/213 (0.178404) | 38/213 (0.178404) | 2.166188433 | 22.962887492 |
| paste_memory | 90/213 (0.422535) | 149/213 (0.699531) | 38/213 (0.178404) | 38/213 (0.178404) | 1.991362596 | 22.914939341 |
| goalspec_no_memory | 79/213 (0.370892) | 135/213 (0.633803) | 38/213 (0.178404) | 38/213 (0.178404) | 2.148090094 | 22.963374577 |
| goalspec | 91/213 (0.427230) | 141/213 (0.661972) | 38/213 (0.178404) | 38/213 (0.178404) | 2.040356118 | 22.959270599 |
| oracle_goals | 80/213 (0.375587) | 147/213 (0.690141) | 38/213 (0.178404) | 38/213 (0.178404) | 2.111704888 | 22.975029523 |
| shuffled_goals | 84/213 (0.394366) | 141/213 (0.661972) | 38/213 (0.178404) | 38/213 (0.178404) | 2.156909235 | 22.967314438 |

| Treatment vs local PASTE | Loss | Family-weighted reduction | 95% family interval | Relative reduction |
| --- | --- | ---: | --- | ---: |
| stateless | toolNll | -0.389564549 | [-0.610896708, -0.167669160] | -17.670680% |
| stateless | actionNll | -2.852752313 | [-3.921610317, -1.595252683] | -11.513122% |
| paste_memory | toolNll | +0.119280484 | [+0.068166081, +0.173370861] | +5.410573% |
| paste_memory | actionNll | +0.028979851 | [+0.015857415, +0.040808444] | +0.116957% |
| goalspec_no_memory | toolNll | +0.041808542 | [-0.004089542, +0.117122597] | +1.896439% |
| goalspec_no_memory | actionNll | -0.000310068 | [-0.000653572, +0.000000000] | -0.001251% |
| goalspec | toolNll | +0.108296517 | [+0.021795076, +0.207352812] | +4.912339% |
| goalspec | actionNll | +0.001590225 | [-0.006320501, +0.009057514] | +0.006418% |
| oracle_goals | toolNll | +0.032077355 | [-0.014739095, +0.087583150] | +1.455032% |
| oracle_goals | actionNll | -0.007297472 | [-0.013376137, -0.000341102] | -0.029451% |
| shuffled_goals | toolNll | -0.010460488 | [-0.078120987, +0.053578461] | -0.474489% |
| shuffled_goals | actionNll | -0.002037738 | [-0.010391737, +0.006806645] | -0.008224% |

## Identical candidate pool ranking controls

All entries use 213 checkpoints. Full-argument accuracy requires the correct tool and the complete current argument object.

| Condition | Tool top-1 | Tool top-3 | Full args top-1 | Full args top-3 | Tool NLL | Action NLL |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| stateless__same_pool | 36/213 (0.169014) | 70/213 (0.328638) | 38/213 (0.178404) | 38/213 (0.178404) | 2.637135236 | 23.243994580 |
| local_paste__same_pool | 83/213 (0.389671) | 135/213 (0.633803) | 38/213 (0.178404) | 38/213 (0.178404) | 2.166188433 | 22.962887492 |
| paste_memory__same_pool | 90/213 (0.422535) | 149/213 (0.699531) | 38/213 (0.178404) | 38/213 (0.178404) | 1.991362596 | 22.914939341 |
| goalspec_no_memory__same_pool | 79/213 (0.370892) | 135/213 (0.633803) | 38/213 (0.178404) | 38/213 (0.178404) | 2.148090094 | 22.963374577 |
| goalspec__same_pool | 91/213 (0.427230) | 141/213 (0.661972) | 38/213 (0.178404) | 38/213 (0.178404) | 2.040356118 | 22.959270599 |
| oracle_goals__same_pool | 80/213 (0.375587) | 147/213 (0.690141) | 38/213 (0.178404) | 38/213 (0.178404) | 2.111704888 | 22.975029523 |
| shuffled_goals__same_pool | 84/213 (0.394366) | 141/213 (0.661972) | 38/213 (0.178404) | 38/213 (0.178404) | 2.156909235 | 22.967314438 |

| Treatment vs local PASTE | Loss | Family-weighted reduction | 95% family interval | Relative reduction |
| --- | --- | ---: | --- | ---: |
| stateless | toolNll | -0.389564549 | [-0.610896708, -0.167669160] | -17.670680% |
| stateless | actionNll | -0.170076099 | [-0.242200846, -0.093813150] | -0.686392% |
| paste_memory | toolNll | +0.119280484 | [+0.068166081, +0.173370861] | +5.410573% |
| paste_memory | actionNll | +0.028979851 | [+0.015857415, +0.040808444] | +0.116957% |
| goalspec_no_memory | toolNll | +0.041808542 | [-0.004089542, +0.117122597] | +1.896439% |
| goalspec_no_memory | actionNll | -0.000310068 | [-0.000653572, +0.000000000] | -0.001251% |
| goalspec | toolNll | +0.108296517 | [+0.021795076, +0.207352812] | +4.912339% |
| goalspec | actionNll | +0.001590225 | [-0.006320501, +0.009057514] | +0.006418% |
| oracle_goals | toolNll | +0.032077355 | [-0.014739095, +0.087583150] | +1.455032% |
| oracle_goals | actionNll | -0.007297472 | [-0.013376137, -0.000341102] | -0.029451% |
| shuffled_goals | toolNll | -0.010460488 | [-0.078120987, +0.053578461] | -0.474489% |
| shuffled_goals | actionNll | -0.002037738 | [-0.010391737, +0.006806645] | -0.008224% |

NLL is in nats with probability floor 1e-12. Positive paired reduction favors the treatment. 'Entropy reduction' here is a predictive cross-entropy estimate, not a measurement of true conditional entropy. Intervals use 14 families in two domains, 2,000 bootstrap draws and seed 42, with no multiple-comparison adjustment.

The identical-pool control verifies the same bound candidate actions for all seven rankers at each checkpoint. It changes only tool-level ranking and allocates each tool's probability uniformly across its candidate argument objects; it does not establish a learned within-tool argument ranker. These frozen prediction scores contain no new native execution and do not measure live latency or task success.
