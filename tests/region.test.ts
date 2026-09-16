import {describe, expect, it} from 'vitest';
import {emitQueryProgram} from '../src/program';
import type {QueryProgramFormat, QueryToolConfig} from '../src/program';

// The program-level `region` knob: a caller that knows which region the rows
// came from pins the emitted client to it, so a pasted snippet can't silently
// run against whatever AWS_REGION the reader's shell carries.
//
// Expected strings are written out by hand from each SDK's own documented
// region API — never derived from the emitter — so a regression in either
// direction fails.

const QUERY: QueryToolConfig = {
  operation: 'Query',
  tableName: 'Orders',
  hashKey: {field: 'pk', type: 'S', value: 'USER#1'},
  limit: 25
};

const REGION = 'eu-west-1';

// PartiQL refuses a `Limit` (an ExecuteStatement API parameter, not statement
// syntax), so its cases drop it — the region behaviour under test is unrelated.
const {limit: _limit, ...QUERY_NO_LIMIT} = QUERY;

function code(config: QueryToolConfig, format: QueryProgramFormat): string {
  const result = emitQueryProgram(config, format);
  if (!result.ok) throw new Error(`expected ok, got: ${result.reason}`);
  return result.code;
}

/** Emit the same config with and without a region, for a paired assertion. */
function pair(format: QueryProgramFormat, extra: Partial<QueryToolConfig> = {}) {
  return {
    without: code({...QUERY, ...extra}, format),
    with: code({...QUERY, ...extra, region: REGION}, format)
  };
}

describe('region — client init per target', () => {
  it('SDK v3: region rides in the client options object', () => {
    const {without, with: pinned} = pair('sdk');
    expect(without).toContain('const client = new DynamoDBClient({});');
    expect(pinned).toContain('const client = new DynamoDBClient({ region: "eu-west-1" });');
  });

  it('DocumentClient: both the single-request and paginate forms are pinned', () => {
    expect(code({...QUERY, region: REGION}, 'docclient')).toContain(
      'const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "eu-west-1" }));'
    );
    expect(code({...QUERY, region: REGION, paginate: true}, 'docclient')).toContain(
      'const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "eu-west-1" }));'
    );
  });

  it('dynamodb-toolbox: the underlying DynamoDBClient is pinned', () => {
    const {without, with: pinned} = pair('ddbtoolbox');
    expect(without).toContain(
      'const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));'
    );
    expect(pinned).toContain(
      'const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "eu-west-1" }));'
    );
  });

  it('CLI: --region is a quoted global flag, after the operation flags', () => {
    const {without, with: pinned} = pair('cli');
    expect(without).not.toContain('--region');
    expect(pinned).toContain("--region 'eu-west-1'");
    // Global option, so it comes after --page-size rather than among the
    // operation's own flags.
    expect(pinned.indexOf('--region')).toBeGreaterThan(pinned.indexOf('--page-size'));
  });

  it('boto3: region_name client kwarg', () => {
    const {without, with: pinned} = pair('boto3');
    expect(without).toContain('client = boto3.client("dynamodb")');
    expect(pinned).toContain('client = boto3.client("dynamodb", region_name="eu-west-1")');
  });

  it('Java: Region.of via the client builder, plus the regions import', () => {
    const {without, with: pinned} = pair('java');
    expect(without).toContain('DynamoDbClient client = DynamoDbClient.create();');
    expect(without).not.toContain('software.amazon.awssdk.regions.Region');
    expect(pinned).toContain(
      'DynamoDbClient client = DynamoDbClient.builder().region(Region.of("eu-west-1")).build();'
    );
    expect(pinned).toContain('import software.amazon.awssdk.regions.Region;');
    // `regions` must sort before `services` to keep the import block ordered.
    expect(pinned.indexOf('software.amazon.awssdk.regions.Region')).toBeLessThan(
      pinned.indexOf('software.amazon.awssdk.services.dynamodb.DynamoDbClient')
    );
  });

  it('Go: config.WithRegion option on LoadDefaultConfig', () => {
    const {without, with: pinned} = pair('go');
    expect(without).toContain('cfg, err := config.LoadDefaultConfig(context.TODO())');
    expect(pinned).toContain(
      'cfg, err := config.LoadDefaultConfig(context.TODO(), config.WithRegion("eu-west-1"))'
    );
  });

  it('.NET: RegionEndpoint.GetBySystemName, plus the root Amazon using', () => {
    const {without, with: pinned} = pair('dotnet');
    expect(without).toContain('var client = new AmazonDynamoDBClient();');
    expect(without).not.toContain('using Amazon;');
    expect(pinned).toContain(
      'var client = new AmazonDynamoDBClient(RegionEndpoint.GetBySystemName("eu-west-1"));'
    );
    expect(pinned).toContain('using Amazon;');
  });

  it('Rust: Region::new on the config loader, plus the config::Region use', () => {
    const {without, with: pinned} = pair('rust');
    expect(without).toContain('let config = aws_config::load_from_env().await;');
    expect(without).not.toContain('use aws_sdk_dynamodb::config::Region;');
    expect(pinned).toContain('use aws_sdk_dynamodb::config::Region;');
    expect(pinned).toContain(
      ['    let config = aws_config::from_env()', '        .region(Region::new("eu-west-1"))', '        .load()', '        .await;'].join(
        '\n'
      )
    );
  });

  it('Kotlin: fromEnvironment config block overrides the region', () => {
    const {without, with: pinned} = pair('kotlin');
    expect(without).toContain('DynamoDbClient.fromEnvironment().use { client ->');
    expect(pinned).toContain(
      'DynamoDbClient.fromEnvironment { region = "eu-west-1" }.use { client ->'
    );
  });

  it('PHP: the known region replaces the placeholder default', () => {
    const {without, with: pinned} = pair('php');
    // aws-sdk-php requires a region at construction, so the unpinned form keeps
    // its documented placeholder rather than dropping the key.
    expect(without).toContain("'region' => 'us-east-1'");
    expect(pinned).toContain(
      "$client = new DynamoDbClient(['region' => 'eu-west-1', 'version' => 'latest']);"
    );
  });

  it('Ruby: region keyword on Client.new', () => {
    const {without, with: pinned} = pair('ruby');
    expect(without).toContain('client = Aws::DynamoDB::Client.new\n');
    expect(pinned).toContain("client = Aws::DynamoDB::Client.new(region: 'eu-west-1')");
  });

  it('PartiQL: a statement has no client, so the region is dropped, not faked', () => {
    const without = code(QUERY_NO_LIMIT, 'partiql');
    const pinned = code({...QUERY_NO_LIMIT, region: REGION}, 'partiql');
    expect(pinned).toBe(without);
    expect(pinned).not.toContain('eu-west-1');
  });
});

describe('region — quoting', () => {
  it('escapes a value that would otherwise break out of a quoted literal', () => {
    // Not a real region id, but the emitters must never let one become syntax.
    const odd = "us-east-1'; rm -rf /";
    expect(code({...QUERY, region: odd}, 'cli')).toContain(
      `--region 'us-east-1'\\''; rm -rf /'`
    );
    expect(code({...QUERY, region: odd}, 'php')).toContain(
      "'region' => 'us-east-1\\'; rm -rf /'"
    );
    expect(code({...QUERY, region: odd}, 'ruby')).toContain(
      "Client.new(region: 'us-east-1\\'; rm -rf /')"
    );
    expect(code({...QUERY, region: odd}, 'sdk')).toContain(
      'new DynamoDBClient({ region: "us-east-1\'; rm -rf /" });'
    );
  });
});

describe('region — every format stays emittable', () => {
  const FORMATS: QueryProgramFormat[] = [
    'sdk',
    'docclient',
    'cli',
    'boto3',
    'partiql',
    'java',
    'go',
    'dotnet',
    'rust',
    'kotlin',
    'php',
    'ruby',
    'ddbtoolbox'
  ];

  it.each(FORMATS)('%s emits with a region set, paginated and not', (format) => {
    const base = format === 'partiql' ? QUERY_NO_LIMIT : QUERY;
    expect(code({...base, region: REGION}, format).length).toBeGreaterThan(0);
    const paged = emitQueryProgram({...base, region: REGION, paginate: true}, format);
    expect(paged.ok).toBe(true);
  });

  it.each(FORMATS.filter((f) => f !== 'php'))(
    '%s is byte-identical to today when no region is given',
    (format) => {
      // The additive guarantee: an unpinned config must emit exactly what it
      // emitted before this knob existed.
      const base = format === 'partiql' ? QUERY_NO_LIMIT : QUERY;
      expect(code({...base, region: undefined}, format)).toBe(code(base, format));
    }
  );
});
