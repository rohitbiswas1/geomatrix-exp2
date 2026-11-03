import { analyticsResponse } from '../../../../lib/analyticsRoute';
export async function GET(request: Request) { return analyticsResponse(request, 'drivers'); }
