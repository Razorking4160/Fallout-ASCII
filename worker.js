/* Static host entry point. The game has no server logic, API or database:
   every request is answered from the uploaded build in dist/. */
export default {
  fetch(request, env) {
    return env.ASSETS.fetch(request);
  }
};
