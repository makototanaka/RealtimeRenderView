export class Shader {
  readonly program: WebGLProgram;

  private gl: WebGL2RenderingContext;

  constructor(
    gl: WebGL2RenderingContext,
    vertSrc: string,
    fragSrc: string,
  ) {
    this.gl = gl;
    const vert = this.compile(gl.VERTEX_SHADER, vertSrc);
    const frag = this.compile(gl.FRAGMENT_SHADER, fragSrc);
    const program = gl.createProgram()!;
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Shader link error: ${gl.getProgramInfoLog(program)}`);
    }
    gl.deleteShader(vert);
    gl.deleteShader(frag);
    this.program = program;
  }

  private compile(type: number, src: string): WebGLShader {
    const shader = this.gl.createShader(type)!;
    this.gl.shaderSource(shader, src);
    this.gl.compileShader(shader);
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      throw new Error(`Shader compile error: ${this.gl.getShaderInfoLog(shader)}`);
    }
    return shader;
  }

  use(): void {
    this.gl.useProgram(this.program);
  }

  setUniform1f(name: string, value: number): void {
    this.gl.uniform1f(this.gl.getUniformLocation(this.program, name), value);
  }

  setUniform1i(name: string, value: number): void {
    this.gl.uniform1i(this.gl.getUniformLocation(this.program, name), value);
  }

  setUniform2f(name: string, x: number, y: number): void {
    this.gl.uniform2f(this.gl.getUniformLocation(this.program, name), x, y);
  }

  setUniform3f(name: string, x: number, y: number, z: number): void {
    this.gl.uniform3f(this.gl.getUniformLocation(this.program, name), x, y, z);
  }

  setUniform3fv(name: string, v: Float32Array | number[]): void {
    this.gl.uniform3fv(this.gl.getUniformLocation(this.program, name), v);
  }

  setUniformMatrix3fv(name: string, matrix: Float32Array): void {
    this.gl.uniformMatrix3fv(this.gl.getUniformLocation(this.program, name), false, matrix);
  }

  setUniformMatrix4fv(name: string, matrix: Float32Array): void {
    this.gl.uniformMatrix4fv(this.gl.getUniformLocation(this.program, name), false, matrix);
  }

  setTexture2D(name: string, texture: WebGLTexture, unit: number): void {
    this.gl.activeTexture(this.gl.TEXTURE0 + unit);
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    this.gl.uniform1i(this.gl.getUniformLocation(this.program, name), unit);
  }

  setTextureCube(name: string, texture: WebGLTexture, unit: number): void {
    this.gl.activeTexture(this.gl.TEXTURE0 + unit);
    this.gl.bindTexture(this.gl.TEXTURE_CUBE_MAP, texture);
    this.gl.uniform1i(this.gl.getUniformLocation(this.program, name), unit);
  }

  dispose(): void {
    this.gl.deleteProgram(this.program);
  }
}
