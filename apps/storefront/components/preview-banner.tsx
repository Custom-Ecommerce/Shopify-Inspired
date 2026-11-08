/**
 * The bar a seller sees while previewing, rendered once by the tenant layout so no theme has to know about it. It sits at
 * the bottom of the window because a theme's header may be fixed to the top. Exit is a plain form: the cookie is httpOnly,
 * and a full page load leaves nothing of the preview behind in the router's memory.
 */
export function PreviewBanner({ notLiveYet }: { notLiveYet: boolean }) {
  return (
    <>
      <div aria-hidden="true" className="h-14" />
      <div
        role="status"
        className="fixed inset-x-0 bottom-0 z-[100] flex h-14 items-center justify-center gap-4 bg-blue-600 px-4 text-sm font-medium text-white"
      >
        <span>
          Preview: only you can see this.{notLiveYet ? " Your store is not live yet." : ""} Orders are turned off.
        </span>
        <form action="/api/storefront/preview/exit" method="post">
          <button type="submit" className="rounded-md bg-white px-3 py-1 font-semibold text-blue-700">
            Exit preview
          </button>
        </form>
      </div>
    </>
  );
}
