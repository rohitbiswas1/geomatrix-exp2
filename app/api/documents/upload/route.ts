import { checkOrigin, requireBackendSession } from '../../../../lib/backend';
import {NextResponse} from 'next/server';

const maxFileSize=10*1024*1024;
const allowedTypes=new Set(['application/pdf','image/jpeg','image/png']);

export async function POST(req:Request){
  const originError = checkOrigin(req); if (originError) return originError;
const authError = await requireBackendSession(); if (authError) return authError;

  const fd=await req.formData();
  const file=fd.get('file');
  if(!(file instanceof File))return NextResponse.json({error:'A document file is required'},{status:400});
  if(file.size>maxFileSize)return NextResponse.json({error:'Document must be 10 MB or smaller'},{status:413});
  if(!allowedTypes.has(file.type))return NextResponse.json({error:'Only PDF, JPEG, and PNG documents are supported'},{status:415});
  return NextResponse.json(
    { error: 'Document extraction is unavailable until persistent document storage and processing are configured.' },
    { status: 501 },
  );
}
