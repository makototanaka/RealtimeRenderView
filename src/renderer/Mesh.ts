import type { MeshData, SubMesh } from '../loader/OBJLoader';

export class Mesh {
  readonly vao: WebGLVertexArrayObject;
  readonly indexCount: number;
  readonly submeshes: SubMesh[];
  private vbo: WebGLBuffer;
  private ebo: WebGLBuffer;
  private gl: WebGL2RenderingContext;

  constructor(gl: WebGL2RenderingContext, data: MeshData, program: WebGLProgram) {
    this.gl = gl;
    this.vao = gl.createVertexArray()!;
    this.vbo = gl.createBuffer()!;
    this.ebo = gl.createBuffer()!;
    this.indexCount = data.indices.length;
    this.submeshes  = data.submeshes;

    gl.bindVertexArray(this.vao);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data.vertices, gl.STATIC_DRAW);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ebo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.indices, gl.STATIC_DRAW);

    const stride = 8 * 4; // 8 floats * 4 bytes
    this.setAttrib(program, 'a_position', 3, stride, 0);
    this.setAttrib(program, 'a_normal',   3, stride, 3 * 4);
    this.setAttrib(program, 'a_uv',       2, stride, 6 * 4);

    gl.bindVertexArray(null);
  }

  private setAttrib(program: WebGLProgram, name: string, size: number, stride: number, offset: number): void {
    const loc = this.gl.getAttribLocation(program, name);
    if (loc < 0) return;
    this.gl.enableVertexAttribArray(loc);
    this.gl.vertexAttribPointer(loc, size, this.gl.FLOAT, false, stride, offset);
  }

  drawSubmesh(start: number, count: number): void {
    this.gl.bindVertexArray(this.vao);
    this.gl.drawElements(this.gl.TRIANGLES, count, this.gl.UNSIGNED_INT, start * 4);
    this.gl.bindVertexArray(null);
  }

  draw(): void {
    this.gl.bindVertexArray(this.vao);
    this.gl.drawElements(this.gl.TRIANGLES, this.indexCount, this.gl.UNSIGNED_INT, 0);
    this.gl.bindVertexArray(null);
  }

  dispose(): void {
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteBuffer(this.vbo);
    this.gl.deleteBuffer(this.ebo);
  }
}
