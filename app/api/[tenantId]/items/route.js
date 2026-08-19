export async function GET(request, { params }) {
  const { tenantId } = await params
  return Response.json({ tenantId, items: [] })
}
