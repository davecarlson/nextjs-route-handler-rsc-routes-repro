export async function GET(request, { params }) {
  const { tenantId, itemId } = await params
  return Response.json({ tenantId, itemId })
}
