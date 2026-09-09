export async function toMemoryFile(file: File): Promise<File> {
  const buf = await file.arrayBuffer();
  return new File([buf], file.name, { type: file.type });
}
