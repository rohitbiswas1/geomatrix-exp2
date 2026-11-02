import { checkOrigin, requireBackendSession } from '../../../../lib/backend';
import { NextResponse } from 'next/server';
import { buildGeojson } from '../../_demo-data';

export async function GET(request: Request) {
  const authError = await requireBackendSession(); if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const riskLevel = searchParams.get('risk_level');
  const geoJson = buildGeojson();

  if (!riskLevel) {
    return NextResponse.json(geoJson);
  }

  const filtered = {
    ...geoJson,
    features: geoJson.features.filter((feature) =>
      String(feature.properties?.risk_level ?? '').toLowerCase() === riskLevel.toLowerCase(),
    ),
  };

  return NextResponse.json(filtered);
}
