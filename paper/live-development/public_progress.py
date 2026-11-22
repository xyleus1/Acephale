import argparse, json
from pathlib import Path

def project(observation):
    rows = []
    for block in observation['blocks']:
        for record in block['rows']:
            outcome = record['outcome']
            fields = ('runId', 'arm', 'armOrder', 'domain', 'familyId', 'taskId', 'pairedBlockId',
                      'predictorTrainingSeed', 'seed', 'trial', 'authoritativeCalls', 'speculativeCalls',
                      'revalidationCalls', 'constraintViolations', 'evaluationValid',
                      'measuredTimingValid', 'qualificationAsserted', 'validated', 'knownUsageSubtotalUsd')
            row = {key: outcome[key] for key in fields if key in outcome}
            row['officialReward'] = record['officialReward']
            row['outcomesSha256'] = block['outcomesRef']['sha256']
            row['nativeArtifactSha256'] = record['nativeArtifactRef']['sha256']
            rows.append(row)
    return {
        'observedAt': observation['observedAt'],
        'scope': observation['scope'],
        'validationStatus': 'unvalidated',
        'studyComplete': False,
        'rows': rows,
        'counts': {
            'uniqueRuns': len({row['runId'] for row in rows}),
            'rewardOne': sum(row['officialReward'] == 1 for row in rows),
            'withConstraintViolations': sum(row['constraintViolations'] > 0 for row in rows),
            'validTimings': sum(row['measuredTimingValid'] for row in rows),
            'speculativeCalls': sum(row['speculativeCalls'] for row in rows),
        },
        'notes': [
            'This snapshot covers nine new development blocks, not the full study.',
            'Earlier completed cases and failed startup attempts are retained separately.',
            'Database reward and policy compliance are separate outcomes.',
            'Invalid comparative latency values are intentionally omitted.',
            'Usage is recorded API usage, not an invoice or account-credit balance.',
        ],
    }

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('input')
    parser.add_argument('output')
    args = parser.parse_args()
    result = project(json.loads(Path(args.input).read_text()))
    Path(args.output).write_text(json.dumps(result, indent=2, sort_keys=True) + '\n')
