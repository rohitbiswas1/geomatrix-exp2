import { checkOrigin, requireBackendSession } from '../../../../../lib/backend';
import {NextResponse} from 'next/server';export async function POST(_:Request,{params}:{params:Promise<{id:string}>}){
  const originError = checkOrigin(_); if (originError) return originError;
const authError = await requireBackendSession(); if (authError) return authError;
return NextResponse.json({id:(await params).id,status:'Acknowledged',timestamp:new Date().toISOString()})}
