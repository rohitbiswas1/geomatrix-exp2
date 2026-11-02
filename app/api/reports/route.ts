import { checkOrigin, requireBackendSession } from '../../../lib/backend';
import {NextResponse} from 'next/server';export async function GET(){
  const authError = await requireBackendSession(); if (authError) return authError;
return NextResponse.json({reports:['Executive Risk Summary','District Risk Report','Project Risk Report','Delay Driver Report','Intervention Report']})}
